/**
 * 允许组件源码以副作用方式引入全局样式。
 *
 * Tree 发布的是普通 CSS，而不是 CSS Modules，因此这里不导出 class 映射；
 * `import './style.css'` 只负责让打包工具收集样式资源。
 */
declare module '*.css';

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
