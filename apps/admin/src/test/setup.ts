import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }) });
// jsdom 不执行布局，提供组件订阅所需的空观察器；尺寸由浏览器验收覆盖。
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { value: TestResizeObserver, configurable: true });
