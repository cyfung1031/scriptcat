import chromeMock from "@Packages/chrome-extension-mock";

chromeMock.init();

if (!("onanimationstart" in global)) {
    // Define or mock the global handler
    let val: any = null;
    Object.defineProperty(global, "onanimationstart", {
        configurable: true,
        enumerable: true,
        set(newVal) {
            val = newVal;
        },
        get() {
            return val;
        }
    });
}
