// ExtTimer
// 基于 chrome.alarms 的高层调度器（MV3 友好）
// ——重构版 v3.4：队列仅存 taskId、enqueueJob 不再传 waitMs（从最新快照读取 plannedAtMs）
// ——批量偏移先规划 plannedAtMs，≥60s 直接更新 due 并回堆；<60s 由运行线程 sleep

/*
 * 设计要点（结合 chrome.alarms 特性与你的规范）：
 * - chrome.alarms 为“尽力而为”分钟级定时器（最小 1 分钟），可能因系统休眠/省电/Service Worker 唤醒产生延迟
 * - 若实际触发与计划时间偏移 ≥ 65 秒，视为“非理想排程”；需为任务增加 8–24 秒随机延迟，避免恢复风暴
 * - 同一 due 的任务允许同时执行（不对同 due 内部再打散）
 * - 队列只存 taskId；真正执行前再以 this.timers 查最新快照，避免旧快照不一致
 * - interval 使用锚点 anchor 对齐节拍：找到 anchor + k*period 中“第一个 ≥ now()”的点作为 due
 */

// =================== 类型定义 ===================

export type TimerId = string;
export type TimerKind = "timeout" | "interval" | "at";

export interface TimerData<T = unknown> {
  id: TimerId; // 任务 ID，格式 <group>:<name>
  kind: TimerKind; // timeout | interval | at
  due: number; // 下一次到期时间（毫秒时间戳）
  periodMs?: number; // interval 周期
  payload?: T; // 任务载荷
  remainingRuns?: number; // interval 剩余执行次数（可选）
  anchor?: number; // interval 锚点（用于漂移校正）
  persist?: boolean; // 是否持久化
  /** 批量偏移场景下，为该任务规划的“应当执行时间”（毫秒）。
   *  跨重启保持一致；执行/重算下一拍后需要清空。 */
  plannedAtMs?: number;
}

export type ExtTimerLogLevel = "debug" | "info" | "warn" | "error" | "none";
export type ExtTimerLogger = Pick<Console, "info" | "warn" | "error" | "debug">;

export interface ExtTimerOptions {
  namespace?: string; // 命名空间（前缀到 alarm.name）
  maxConcurrency?: number; // 最大并发处理数，默认 4
  handlerTimeoutMs?: number; // 单个处理器看门狗超时，默认 30s
  persist?: boolean; // 是否持久化到 storage.local，默认 true
  logLevel?: ExtTimerLogLevel; // 日志级别，默认 info
  logger?: ExtTimerLogger; // 自定义 logger

  useBucketAlarms?: boolean; // 是否使用“分钟桶”模式，默认 true
  bucketMinutes?: number[]; // 分钟桶集合，默认 [5,10,30,60,180,480,1440]
  bucketSkewToleranceMs?: number; // 桶边界容忍偏差，默认 10s
}

// 回调
export type TimerHandler<T = unknown> = (event: TimerData<T>) => Promise<void> | void;
export type LifecycleHandler<T = unknown> = (
  event: "create" | "cancel" | "executed",
  timer: TimerData<T> | null
) => void;

// =================== 常量 ===================

const DEFAULTS = {
  MAX_CONCURRENCY: 4,
  HANDLER_TIMEOUT_MS: 30_000,
  PERSIST: true,
  LOG_LEVEL: "info" as const,

  USE_BUCKET_ALARMS: true,
  BUCKET_MINUTES: [5, 10, 30, 60, 180, 480, 1440],
  BUCKET_SKEW_TOLERANCE_MS: 10_000,

  MIN_GRANULARITY_MS: 60_000, // chrome.alarms 最小 1 分钟粒度

  // 偏移阈值与批量延迟范围
  DRIFT_THRESHOLD_MS: 65_000, // 偏移 ≥ 65 秒，视为非理想排程
  RESCHED_MIN_DELAY_MS: 8_000, // 批量打散最小延迟
  RESCHED_MAX_DELAY_MS: 24_000, // 批量打散最大延迟
} as const;

// =================== 工具函数 ===================

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const now = () => Date.now();
const clampMin = (ms: number, min: number) => Math.max(min, ms);
const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const uid = (prefix = "t", group = "") =>
  `${group ? group + ":" : ""}${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

async function callChrome<T>(fn: () => Promise<T> | T, label: string, log: Logger): Promise<T> {
  try {
    const result = await fn();
    // @ts-ignore
    const lastErr: any = chrome.runtime?.lastError;
    if (lastErr) throw new Error(`${label}: ${lastErr?.message || lastErr}`);
    return result as T;
  } catch (err) {
    log.warn(`[ExtTimer] ${label} 失败:`, err);
    throw err;
  }
}

function nextBucketWhenMs(m: number, toleranceMs: number): number {
  const periodMs = m * 60_000;
  const n = now();
  const k = Math.ceil((n - toleranceMs) / periodMs);
  return k * periodMs;
}

function fitsBucket(due: number, m: number, tolMs: number): boolean {
  const periodMs = m * 60_000;
  const k = Math.round(due / periodMs);
  const edge = k * periodMs;
  return Math.abs(edge - due) <= tolMs;
}

function splitId(id: string): { group: string; name: string } {
  const i = id.indexOf(":");
  return i < 0 ? { group: "", name: id } : { group: id.slice(0, i), name: id.slice(i + 1) };
}

function matchIdPattern(id: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const { group, name } = splitId(id);
  const [pg, pn] = pattern.split(":");
  const okGroup = pg === "*" || group === pg;
  const okName = pn === undefined || pn === "*" || name === pn;
  return okGroup && okName;
}

// =================== 日志器 ===================

class Logger {
  level: ExtTimerLogLevel;
  constructor(
    level: ExtTimerLogLevel,
    private readonly out?: ExtTimerLogger
  ) {
    this.level = level ?? DEFAULTS.LOG_LEVEL;
  }
  private ok(want: ExtTimerLogLevel) {
    const order = ["debug", "info", "warn", "error", "none"];
    return order.indexOf(want) >= order.indexOf(this.level) && this.level !== "none";
  }
  debug(...a: any[]) {
    if (this.ok("debug")) this.out?.debug?.(...a);
  }
  info(...a: any[]) {
    if (this.ok("info")) this.out?.info?.(...a);
  }
  warn(...a: any[]) {
    if (this.ok("warn")) this.out?.warn?.(...a);
  }
  error(...a: any[]) {
    if (this.ok("error")) this.out?.error?.(...a);
  }
}

// =================== 有界并发队列 ===================

class AsyncQueue {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];
  constructor(
    private readonly limit: number,
    private readonly watchdogMs: number,
    private readonly log: Logger
  ) {}

  push(task: () => Promise<void>) {
    this.queue.push(task);
    this.drain();
  }

  private async drain() {
    while (this.running < this.limit && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      const run = async () => {
        try {
          if (this.watchdogMs > 0) {
            await Promise.race([
              job(),
              sleep(this.watchdogMs).then(() => {
                throw new Error(`watchdog ${this.watchdogMs}ms`);
              }),
            ]);
          } else {
            await job();
          }
        } catch (e) {
          this.log.error("[ExtTimer] 处理器异常:", e);
        } finally {
          this.running--;
          queueMicrotask(() => this.drain());
        }
      };
      run();
    }
  }
}

// =================== 小顶堆（按 due 排序） ===================

class MinHeap<T extends { due: number; id: string }> {
  private a: T[] = [];
  size() {
    return this.a.length;
  }
  peek() {
    return this.a[0];
  }
  push(v: T) {
    this.a.push(v);
    this.up(this.a.length - 1);
  }
  pop(): T | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0],
      last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      this.down(0);
    }
    return top;
  }
  removeIf(pred: (t: T) => boolean) {
    this.a = this.a.filter((t) => !pred(t));
    this.reheap();
  }
  reheap() {
    for (let i = (this.a.length >> 1) - 1; i >= 0; i--) this.down(i);
  }
  private up(i: number) {
    while (i) {
      const p = (i - 1) >> 1;
      if (this.a[p].due <= this.a[i].due) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  private down(i: number) {
    const n = this.a.length;
    while (true) {
      const l = i * 2 + 1,
        r = l + 1;
      let m = i;
      if (l < n && this.a[l].due < this.a[m].due) m = l;
      if (r < n && this.a[r].due < this.a[m].due) m = r;
      if (m === i) break;
      [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
      i = m;
    }
  }
}

// =================== ExtTimer 主体 ===================

export class ExtTimer<T = unknown> {
  private readonly ns: string;
  private readonly opts: Required<
    Pick<
      ExtTimerOptions,
      | "maxConcurrency"
      | "handlerTimeoutMs"
      | "persist"
      | "logLevel"
      | "useBucketAlarms"
      | "bucketMinutes"
      | "bucketSkewToleranceMs"
    >
  > & { logger?: ExtTimerLogger };
  private readonly storageKey: string;

  private tickHandlers: TimerHandler<T>[] = [];
  private lifecycleHandlers: LifecycleHandler<T>[] = [];

  private queue: AsyncQueue;
  private heap = new MinHeap<TimerData<T>>();
  private timers = new Map<TimerId, TimerData<T>>();

  private log: Logger;
  private persistTimer: NodeJS.Timeout | null = null;

  private isPaused = false;
  private countExecuted = 0;
  private countErrors = 0;

  private defaultGroup = "";

  constructor(options: ExtTimerOptions = {}) {
    this.ns = (options.namespace ?? "exttimer").replace(/[^-\w]/g, "_");
    this.log = new Logger(options.logLevel ?? DEFAULTS.LOG_LEVEL, options.logger ?? console);
    this.opts = {
      maxConcurrency: options.maxConcurrency ?? DEFAULTS.MAX_CONCURRENCY,
      handlerTimeoutMs: options.handlerTimeoutMs ?? DEFAULTS.HANDLER_TIMEOUT_MS,
      persist: options.persist ?? DEFAULTS.PERSIST,
      logLevel: options.logLevel ?? DEFAULTS.LOG_LEVEL,
      useBucketAlarms: options.useBucketAlarms ?? DEFAULTS.USE_BUCKET_ALARMS,
      bucketMinutes: ((options.bucketMinutes ?? DEFAULTS.BUCKET_MINUTES) as number[]).sort((a, b) => a - b),
      bucketSkewToleranceMs: options.bucketSkewToleranceMs ?? DEFAULTS.BUCKET_SKEW_TOLERANCE_MS,
      logger: options.logger,
    };
    this.storageKey = `${this.ns}:exttimer:v3`;
    this.queue = new AsyncQueue(this.opts.maxConcurrency, this.opts.handlerTimeoutMs, this.log);
    this.bindAlarms();
    void this.init();
  }

  private async init() {
    await this.rehydrate();
    await this.scheduleNextTick();
  }

  // ============ 公共 API ============

  configure(options: { group?: string }) {
    this.defaultGroup = options.group ?? "";
    return this;
  }

  onTick(handler: TimerHandler<T>) {
    if (!this.tickHandlers.includes(handler)) this.tickHandlers.push(handler);
    return this;
  }
  offTick(handler: TimerHandler<T>) {
    this.tickHandlers = this.tickHandlers.filter((h) => h !== handler);
    return this;
  }

  onLife(handler: LifecycleHandler<T>) {
    if (!this.lifecycleHandlers.includes(handler)) this.lifecycleHandlers.push(handler);
    return this;
  }
  offLife(handler: LifecycleHandler<T>) {
    this.lifecycleHandlers = this.lifecycleHandlers.filter((h) => h !== handler);
    return this;
  }

  /**
   * 创建/计划一个定时任务
   * - timeout：delayMs 后一次性执行
   * - at：在 whenMs 指定时刻执行一次
   * - interval：以 periodMs 为周期重复执行（锚点为 whenMs 或创建时刻）
   */
  async schedule(
    options: {
      delayMs?: number;
      whenMs?: number;
      periodMs?: number;
      payload?: T;
      id?: string;
      group?: string;
      remainingRuns?: number;
    },
    payload?: T
  ): Promise<TimerId> {
    // 分组（如果没传 group，就使用默认分组）
    const group = options.group ?? this.defaultGroup;

    // 生成任务 ID：interval → "iv"；at → "at"；timeout → "to"
    const id = options.id ?? uid(options.periodMs ? "iv" : options.whenMs ? "at" : "to", group);

    // 判定任务类型
    const kind: TimerKind = options.periodMs ? "interval" : options.whenMs ? "at" : "timeout";

    // anchor（锚点，仅 interval 使用）：优先 whenMs，否则 now()
    const anchor = kind === "interval" ? (options.whenMs ?? now()) : undefined;

    // 计算任务到期时间 due（中文注释，便于长期维护）
    const due = options.whenMs
      ? // 1) 如果指定了 whenMs（适用于 "at" 或 interval 的 anchor）
        //    → 直接用这个时间，代表明确的触发时刻
        options.whenMs
      : kind === "interval"
        ? // 2) interval（周期任务）：
          //    - from: anchor（可能是 whenMs，也可能是 now()）
          //    - 计算 (now - anchor)/period 已过多少周期
          //    - ceil(...) 取最近且不早于 now() 的那个周期点
          anchor! + Math.ceil((now() - anchor!) / options.periodMs!) * options.periodMs!
        : // 3) timeout（延迟一次性）：
          //    - 从现在时间往后推 delayMs（若未指定则为 0）
          now() + (options.delayMs ?? 0);

    const task: TimerData<T> = {
      id,
      kind,
      due,
      periodMs: options.periodMs,
      anchor,
      payload: payload ?? options.payload,
      remainingRuns: options.remainingRuns,
      persist: this.opts.persist,
    };

    return this.create(task);
  }

  async cancel(id: TimerId) {
    const removed = this.timers.get(id) ?? null;
    this.timers.delete(id);
    this.heap.removeIf((x) => x.id === id);
    if (removed && !this.opts.useBucketAlarms) {
      await this.deleteChromeAlarm(id);
    }
    this.persistSoon();
    this.emitLifecycle("cancel", removed);
  }

  async cancelBy(pattern: string) {
    const pat = pattern.includes(":") || pattern === "*" ? pattern : `${pattern}:*`;
    const ids = [...this.timers.keys()].filter((id) => matchIdPattern(id, pat));
    for (const id of ids) await this.cancel(id);
  }

  pause() {
    this.isPaused = true;
  }
  resume() {
    this.isPaused = false;
    void this.scheduleNextTick();
  }

  async dispose() {
    await this.cancelBy("*");
    await callChrome(() => chrome.alarms.clearAll(), "alarms.clearAll", this.log).catch(() => {});
    chrome.alarms.onAlarm.removeListener(this.onAlarmListener);
    chrome.runtime.onStartup.removeListener(this.onRuntimeStartup);
    chrome.runtime.onInstalled.removeListener(this.onRuntimeInstalled);
  }

  list() {
    return [...this.timers.values()].sort((a, b) => a.due - b.due);
  }

  get(id: TimerId) {
    return this.timers.get(id);
  }

  getDiagnostics() {
    return {
      stats: {
        active: this.timers.size,
        executed: this.countExecuted,
        errors: this.countErrors,
        heapSize: this.heap.size(),
        paused: this.isPaused,
        logLevel: this.opts.logLevel,
      },
      timers: this.list().map((x) => ({
        id: x.id,
        kind: x.kind,
        due: x.due,
        group: splitId(x.id).group,
        payload: x.payload,
      })),
    };
  }

  // ============ 核心调度 ============

  private async create(task: TimerData<T>) {
    this.validate(task);

    // 记录任务
    this.timers.set(task.id, task);

    if (this.opts.useBucketAlarms) {
      const matchedBucket = this.opts.bucketMinutes.find((m) =>
        fitsBucket(task.due, m, this.opts.bucketSkewToleranceMs)
      );
      if (matchedBucket) {
        this.heap.push(task);
        await this.ensureBucketAlarm(matchedBucket);
      } else {
        await this.createChromeAlarm(task);
      }
    } else {
      this.heap.push(task);
      await this.ensureTickAlarm();
    }

    this.persistSoon();
    this.emitLifecycle("create", task);
    return task.id;
  }

  private validate(task: TimerData<T>) {
    if (!task || !task.id) throw new Error("Timer 必须包含 id");
    if (!["timeout", "interval", "at"].includes(task.kind)) throw new Error("非法 kind");
    if (task.kind === "interval" && (task.periodMs ?? 0) <= 0) throw new Error("interval 的 periodMs 必须为正数");
    if (typeof task.remainingRuns === "number" && task.remainingRuns < 0) throw new Error("remainingRuns 不能为负");
    if (task.due < now() - 24 * 60 * 60 * 1000) throw new Error("due 时间戳过旧");
  }

  private async createChromeAlarm(task: TimerData<T>) {
    const name = `${this.ns}:${task.id}`;
    const delayMs = clampMin(task.due - now(), DEFAULTS.MIN_GRANULARITY_MS);
    const existing = await callChrome(() => chrome.alarms.get(name), `alarms.get(${name})`, this.log).catch(
      () => undefined
    );
    if (!existing || Math.abs((existing.scheduledTime ?? 0) - (now() + delayMs)) > 1000) {
      await callChrome(
        () => chrome.alarms.create(name, { when: now() + delayMs }),
        `alarms.create(${name})`,
        this.log
      ).catch(() => {});
    }
  }

  private async deleteChromeAlarm(id: TimerId) {
    const name = `${this.ns}:${id}`;
    await callChrome(() => chrome.alarms.clear(name), `alarms.clear(${name})`, this.log).catch(() => {});
  }

  private async ensureBucketAlarm(m: number) {
    const name = `${this.ns}:bucket:${m}`;
    const nextWhen = nextBucketWhenMs(m, this.opts.bucketSkewToleranceMs);
    const existing = await callChrome(() => chrome.alarms.get(name), `alarms.get(${name})`, this.log).catch(
      () => undefined
    );
    if (!existing || Math.abs((existing.scheduledTime ?? 0) - nextWhen) > 1000) {
      await callChrome(
        () => chrome.alarms.create(name, { when: nextWhen, periodInMinutes: m }),
        `alarms.create(${name})`,
        this.log
      ).catch(() => {});
    }
  }

  private async ensureTickAlarm() {
    const name = `${this.ns}:__tick__`;
    const headDue = this.heap.peek()?.due ?? now() + DEFAULTS.MIN_GRANULARITY_MS;
    const delayMs = clampMin(headDue - now(), DEFAULTS.MIN_GRANULARITY_MS);
    const existing = await callChrome(() => chrome.alarms.get(name), `alarms.get(${name})`, this.log).catch(
      () => undefined
    );
    if (!existing || Math.abs((existing.scheduledTime ?? 0) - (now() + delayMs)) > 1000) {
      await callChrome(
        () => chrome.alarms.create(name, { when: now() + delayMs }),
        `alarms.create(${name})`,
        this.log
      ).catch(() => {});
    }
  }

  private async scheduleNextTick() {
    if (this.isPaused) return;
    if (this.opts.useBucketAlarms) {
      const dues = this.list().map((x) => x.due);
      for (const m of this.opts.bucketMinutes) {
        if (dues.some((d) => fitsBucket(d, m, this.opts.bucketSkewToleranceMs))) {
          await this.ensureBucketAlarm(m);
        }
      }
    } else {
      await this.ensureTickAlarm();
    }
  }

  private onAlarmListener = (alarm: chrome.alarms.Alarm) => {
    if (!alarm.name.startsWith(`${this.ns}:`)) return;
    if (alarm.name.startsWith(`${this.ns}:bucket:`)) {
      void this.onBucketTick();
    } else if (alarm.name === `${this.ns}:__tick__`) {
      void this.onBucketTick();
    } else {
      const id = alarm.name.slice(this.ns.length + 1);
      const task = this.timers.get(id);
      if (task) void this.executeDue([task]);
    }
  };

  private onRuntimeStartup = () => {
    this.log.info("[ExtTimer] onStartup 触发 rehydrate");
    void this.init();
  };
  private onRuntimeInstalled = () => {
    this.log.info("[ExtTimer] onInstalled 触发 rehydrate");
    void this.init();
  };

  private bindAlarms() {
    chrome.alarms.onAlarm.addListener(this.onAlarmListener);
    chrome.runtime.onStartup.addListener(this.onRuntimeStartup);
    chrome.runtime.onInstalled.addListener(this.onRuntimeInstalled);
  }

  private async onBucketTick() {
    if (this.isPaused) return;
    const dueSet: TimerData<T>[] = [];
    const horizon = now() + this.opts.bucketSkewToleranceMs;

    // 从堆顶提取“到期或即将到期”的任务
    while (this.heap.size() && this.heap.peek()!.due <= horizon) {
      const item = this.heap.pop()!;
      if (!this.timers.has(item.id)) continue;
      dueSet.push(item);
    }

    await this.executeDue(dueSet);
    await this.scheduleNextTick();
  }

  // ---------- 队列入列：只记录 taskId；等待逻辑由最新快照的 plannedAtMs 决定 ----------
  private enqueueJob(taskId: string) {
    this.queue.push(async () => {
      try {
        // 执行前以 taskId 取最新快照；可能已被取消或重算
        let task = this.timers.get(taskId);
        if (!task) return;

        // 若存在 plannedAtMs（批量偏移规划）且尚未到点，先等待到规划时间
        if (typeof task.plannedAtMs === "number") {
          const wait1 = task.plannedAtMs - now();
          if (wait1 > 0) await sleep(wait1);
          // 等待期间可能被重算或取消，再取一次最新
          task = this.timers.get(taskId);
          if (!task) return;
        }

        // 触发所有 onTick
        await Promise.all(this.tickHandlers.map((handler) => handler(task!)));
        this.countExecuted++;
        this.emitLifecycle("executed", task!);

        // 收尾（会根据最新的 kind 做下一拍或取消）
        await this.afterRun(task!);
      } catch (e) {
        this.countErrors++;
        this.log.error("[ExtTimer] 处理器抛出异常:", e);
      }
    });
  }

  /**
   * 执行到期任务（重构版）
   * - 刷新快照：以 this.timers 为准，过滤已取消的任务
   * - 正常路径：直接执行（若与 now 偏差超出桶容忍则跳过到下次 tick）
   * - 批量偏移：按唯一 due 升序为“每个 due 值”分配 8–24s 随机延迟并写回 plannedAtMs；
   *             若 plannedAtMs - now ≥ 60s，则直接把 due 更新为 plannedAtMs 并入堆（跨重启安全），且本轮不入列
   * - 入列时只存 taskId；真正执行前再取最新快照与 plannedAtMs
   */
  private async executeDue(pendingTasks: TimerData<T>[]) {
    if (this.isPaused || !pendingTasks.length) return;

    // 统一刷新：以 this.timers 为准，过滤掉已取消的任务
    const live = pendingTasks.map((x) => this.timers.get(x.id) ?? null).filter((x): x is TimerData<T> => !!x);

    if (!live.length) return;

    // 是否属于“批量偏移”（任一项 (now - due) ≥ 65s）
    const isBatchDrift = live.some((x) => now() - x.due >= DEFAULTS.DRIFT_THRESHOLD_MS);

    // 将要入列执行的 taskId 集合（批量规划后 <60s 的才入列；≥60s 直接更新 due 等待 alarm）
    const toEnqueue: string[] = [];

    if (isBatchDrift) {
      // 1) 唯一 due 升序
      const uniqueDues = [...new Set(live.map((x) => x.due))].sort((a, b) => a - b);
      // 2) 生成与 uniqueDues 等长的随机延迟，并升序（保证整体不逆序）
      const baseDelays = Array.from({ length: uniqueDues.length }, () =>
        randInt(DEFAULTS.RESCHED_MIN_DELAY_MS, DEFAULTS.RESCHED_MAX_DELAY_MS)
      ).sort((a, b) => a - b);
      // 3) 建立 due → plannedAtMs 的映射
      const plannedMap = new Map<number, number>(uniqueDues.map((d, i) => [d, d + baseDelays[i]]));

      const toReheap: TimerData<T>[] = [];
      for (const task of live) {
        const plannedAt = plannedMap.get(task.due)!;
        task.plannedAtMs = plannedAt;
        const delta = plannedAt - now();

        // ≥ 60s：直接把 due 更新为 plannedAtMs（由 alarms 唤醒，跨重启一致），本轮不入列
        if (delta >= DEFAULTS.MIN_GRANULARITY_MS) {
          task.due = plannedAt;
          toReheap.push(task);
        } else {
          // < 60s：本轮入列，具体等待由 enqueueJob 内部读取 plannedAtMs 决定
          toEnqueue.push(task.id);
        }
        this.timers.set(task.id, task);
      }

      if (toReheap.length) {
        for (const t of toReheap) this.heap.push(t);
        this.persistSoon();
        await this.scheduleNextTick();
      }
    } else {
      // 非批量偏移：仅当与 now 的偏差在桶容忍范围内才执行；否则等下次 tick
      for (const task of live) {
        if (Math.abs(task.due - now()) <= this.opts.bucketSkewToleranceMs) {
          toEnqueue.push(task.id);
        }
      }
    }

    // 依并发上限入列（只使用 taskId）
    const maxParallel = Math.min(toEnqueue.length, this.opts.maxConcurrency);
    for (let i = 0; i < maxParallel; i++) {
      this.enqueueJob(toEnqueue[i]);
    }
  }

  /**
   * 执行后的收尾：
   * - interval：按锚点做漂移修正，计算下一次 due 并回堆；清理 plannedAtMs
   * - 其他类型：直接取消
   */
  private async afterRun(task: TimerData<T>) {
    if (task.kind === "interval") {
      const period = task.periodMs ?? DEFAULTS.MIN_GRANULARITY_MS;
      const anchor = task.anchor ?? task.due;

      // 对齐到 anchor 的等差序列：找到最近且不早于 now 的 k*period
      const k = Math.ceil((now() - anchor + 1) / period);
      const nextDue = Math.max(anchor + k * period, now());

      const next: TimerData<T> = { ...task, due: nextDue, anchor };
      delete next.plannedAtMs; // 清理批量偏移时设置的计划时间

      if (typeof next.remainingRuns === "number") {
        next.remainingRuns -= 1;
        if (next.remainingRuns <= 0) {
          await this.cancel(task.id);
          return;
        }
      }
      this.timers.set(task.id, next);
      this.heap.push(next);
      this.persistSoon();
      await this.scheduleNextTick();
    } else {
      await this.cancel(task.id);
    }
  }

  private async rehydrate() {
    if (!this.opts.persist) return;
    try {
      const obj = await callChrome(() => chrome.storage.local.get(this.storageKey), "storage.get", this.log);
      const saved: TimerData<T>[] = obj?.[this.storageKey];
      if (Array.isArray(saved)) {
        this.timers.clear();
        this.heap = new MinHeap<TimerData<T>>();
        for (const item of saved) {
          // 非 interval 的过旧任务丢弃
          if (item.kind !== "interval" && item.due < now() - 24 * 60 * 60 * 1000) continue;
          this.timers.set(item.id, item);
          this.heap.push(item);
        }
        await this.scheduleNextTick();
      }
    } catch (e) {
      this.log.warn("[ExtTimer] rehydrate 失败", e);
    }
  }

  private persistSoon() {
    if (!this.opts.persist || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 100);
  }

  private async persist() {
    if (!this.opts.persist) return;
    const data = [...this.timers.values()].filter((x) => x.persist !== false);
    await callChrome(() => chrome.storage.local.set({ [this.storageKey]: data }), "storage.set", this.log).catch(
      (e) => {
        this.log.error("[ExtTimer] 持久化失败", e);
      }
    );
  }

  private emitLifecycle(event: "create" | "cancel" | "executed", task: TimerData<T> | null) {
    this.lifecycleHandlers.forEach((fn) => {
      try {
        fn(event, task);
      } catch (e) {
        this.log.warn("[ExtTimer] 生命周期回调异常", e);
      }
    });
  }
}

// =================== 使用示例（背景 Service Worker） ===================

/*
import { ExtTimer, TimerData } from "./exttimer";

// 1) 创建计时器实例
const timers = new ExtTimer<{ task: string }>({
  namespace: "demo",
  logLevel: "info",
  maxConcurrency: 4,
  handlerTimeoutMs: 30_000,
  persist: true,
  useBucketAlarms: true,
  bucketMinutes: [1, 5, 10, 30],     // 示例：用较小的桶
  bucketSkewToleranceMs: 10_000
}).configure({ group: "global" });

// 2) 业务处理：当任务触发时执行
timers.onTick(async (event: TimerData<{ task: string }>) => {
  console.info("[onTick] 执行任务:", {
    id: event.id,
    kind: event.kind,
    dueISO: new Date(event.due).toISOString(),
    payload: event.payload
  });
});

// 3) 生命周期事件
timers.onLife((ev, task) => {
  console.info("[lifecycle]", ev, task?.id, task?.kind, task ? new Date(task.due).toISOString() : null);
});

// 4) 创建一些任务
await timers.schedule({ delayMs: 5 * 60_000 }, { task: "refresh-cache" });
await timers.schedule({ periodMs: 15 * 60_000 }, { task: "sync" });
await timers.schedule({ whenMs: Date.now() + 3 * 60_000, id: "notify-user-1" }, { task: "notify" });

// 5) 取消与诊断
await timers.cancelBy("global:*");
console.log(timers.getDiagnostics());
*/
