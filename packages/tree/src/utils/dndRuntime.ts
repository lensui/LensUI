/**
 * 拖拽运行时单独放入异步模块：未开启拖拽以及服务端渲染不会加载 Atlaskit DnD。
 * Vite 会把该文件及其依赖输出为独立 chunk。
 */
export { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
export { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
export { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
export { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item';
