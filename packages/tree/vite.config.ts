import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Vite 先清空并生成运行产物，随后 tsc 写入声明文件，避免旧目录结构残留在发布包中。
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    rollupOptions: {
      // React 由宿主复用；DnD 依赖包含大量无扩展名的内部 ESM 引用，保留 external 会让
      // 原生 Node ESM / SSR 无法加载发布包，因此由 Rollup 仅打入 Tree 实际使用的入口。
      external: (id) => ['react', 'react-dom', 'react/jsx-runtime'].includes(id),
    },
  }
});
