// ==UserScript==
// @name         gm add element
// @namespace    https://bbs.tampermonkey.net.cn/
// @version      0.1.0
// @description  在页面中插入元素，可以绕过 CSP（内容安全策略）限制
// @author       You
// @match        https://github.com/scriptscat/scriptcat
// @grant        GM_addElement
// ==/UserScript==

/**
 * GM_addElement
 * ----------------
 * 在指定父节点下创建并插入一个 DOM 元素
 *
 * 与 document.createElement + appendChild 不同：
 * - 可绕过页面 CSP 对 inline / remote 资源的限制
 * - 适合插入 img / script / style 等受限元素
 *
 * 参数说明：
 * 1. 父节点
 * 2. 元素标签名
 * 3. 属性对象
 */

// ------------- 基础用法（TM） B1 ----------------

const el = GM_addElement(document.querySelector('.BorderGrid-cell'), "img", {
    src: "https://bbs.tampermonkey.net.cn/uc_server/avatar.php?uid=4&size=small&ts=1"
});

// 打印创建出来的 DOM 元素
console.log(el);

// ------------- 基础用法（TM） B2 - textContent ----------------


const span3 = GM_addElement('span', {
    textContent: 'Hello',
});

console.log(`span text: ${span3.textContent}`);

// ------------- 基础用法（TM） B3 - onload & onerror ----------------


new Promise((resolve, reject) => {
    img = GM_addElement(document.body, 'img', {
        src: 'https://www.tampermonkey.net/favicon.ico',
        onload: resolve,
        onerror: reject
    });
}).then(() => {
    console.log("img insert ok");
}).catch(() => {
    console.log("img insert failed")
});


if (GM?.info.scriptHandler === "ScriptCat") {

    // ------------- 額外用法（SC） E1 - value ----------------


    const textarea = GM_addElement('textarea', {
        value: "myText",
    });

    console.log(`Textarea Value: ${textarea.value}`);

    // ------------- 額外用法（SC） E2 - innerHTML ----------------

    const div3 = GM_addElement('div', {
        innerHTML: '<div id="test777">World</div>',
    });

    console.log(`div text: ${div3.textContent}`);


    // ------------- 額外用法（SC） E3 - className ----------------


    const span4 = GM_addElement(document.getElementById("test777"), 'span', {
        className: "test777-span",
        textContent: 'Hello World!',
    });

    console.log(`span class: ${span4.classList.contains("test777-span")}`)



    // ------------- 額外用法（SC） E4 - native ----------------

    // 在目前环境生成元素

    const elementA = GM_addElement('div', {
        native: true,
        textContent: "DEF",
    });


    // ------------- 額外用法（SC） E5 - insertBefore ----------------

    // 插入在某元素前面 = parentNdoe.insertBefore(node, referenceNode)

    const elementB = GM_addElement('textarea', {
        value: "ABC",
    }, elementA);

}
