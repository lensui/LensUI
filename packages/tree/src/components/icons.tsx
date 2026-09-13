/**
 * 所有内置图标共用 16 × 16 坐标画布和相同描边粗细。
 * 原始素材的 path 虽然都使用 1024 画布，但图形实际占比不同，会造成视觉大小不一致；
 * 这里将它们规范到组件库统一图标网格。SVG 自身不设置宽高，最终显示尺寸完全由
 * Tree.tsx 中的 `.rc-tree__icon-graphic` 外层容器和 CSS 变量控制。
 */
const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** 素材类 iconfont 图标在 14px 下略显偏细；同色外扩约 28/1024，统一增强视觉重量。 */
const nodeIconProps = {
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeWidth: 28,
  strokeLinejoin: 'round',
  paintOrder: 'stroke fill',
} as const;

/** 展开/收起箭头：图形位于统一的 12 × 12 安全区内。 */
export const Chevron = ({ expanded }: { expanded: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path {...strokeProps} d={expanded ? 'M3.5 6 8 10.5 12.5 6' : 'm6 3.5 4.5 4.5L6 12.5'} />
  </svg>
);

/** 三态选择框：支持未选、全选和部分选中的中间态。 */
export const Check = ({ selected, indeterminate = false }: { selected: boolean; indeterminate?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" data-tree-selection={indeterminate ? 'indeterminate' : selected ? 'checked' : 'unchecked'}>
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" {...strokeProps} fill={selected || indeterminate ? 'currentColor' : 'none'} />
    {selected && <path d="m4.75 8 2.1 2.1 4.4-4.45" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    {indeterminate && <path d="M4.75 8h6.5" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>
);

/** 单选标记：未选中显示圆环，选中后使用主题色实心圆点。 */
export const Radio = ({ selected }: { selected: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" data-tree-selection={selected ? 'radio-checked' : 'radio-unchecked'}>
    <circle cx="8" cy="8" r="5.75" {...strokeProps} fill="none" />
    {selected && <circle cx="8" cy="8" r="3" fill="currentColor" />}
  </svg>
);

/** 六点拖拽手柄：圆点阵列占用与选择框一致的 12 × 12 安全区。 */
export const DragDots = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="5" cy="3.5" r="1.25" fill="currentColor" />
    <circle cx="11" cy="3.5" r="1.25" fill="currentColor" />
    <circle cx="5" cy="8" r="1.25" fill="currentColor" />
    <circle cx="11" cy="8" r="1.25" fill="currentColor" />
    <circle cx="5" cy="12.5" r="1.25" fill="currentColor" />
    <circle cx="11" cy="12.5" r="1.25" fill="currentColor" />
  </svg>
);

/** 搜索：采用 material/搜索.svg 的原始 1024 画布路径，颜色跟随搜索框主题。 */
export const Search = () => (
  <svg viewBox="0 0 1024 1024" aria-hidden="true" data-tree-icon="search">
    <path fill="currentColor" stroke="currentColor" strokeWidth="28" strokeLinejoin="round" paintOrder="stroke fill" d="M952.064 901.39648l-167.40864-167.40864c59.72992-71.15776 95.75424-162.88768 95.75424-263.06048 0-226.1504-183.33184-409.48224-409.48224-409.48224C244.77184 61.44 61.44 244.77184 61.44 470.92224s183.33184 409.48224 409.48224 409.48224c100.1728 0 191.90272-36.0192 263.06048-95.74912l167.40864 167.40864a35.82976 35.82976 0 0 0 50.67264-50.66752zM133.09952 470.92224c0-186.27584 151.54688-337.82272 337.82272-337.82272s337.82272 151.54688 337.82272 337.82272-151.54688 337.82272-337.82272 337.82272-337.82272-151.54688-337.82272-337.82272z" />
  </svg>
);

/** 关闭：采用 material/关  闭.svg，用于清空默认搜索框。 */
export const Close = () => (
  <svg viewBox="0 0 1024 1024" aria-hidden="true" data-tree-icon="close">
    <path fill="currentColor" d="M587.19 506.246l397.116-397.263a52.029 52.029 0 0 0 0-73.143l-2.194-2.194a51.98 51.98 0 0 0-73.143 0l-397.068 397.8-397.068-397.8a51.98 51.98 0 0 0-73.143 0l-2.146 2.194a51.054 51.054 0 0 0 0 73.143l397.069 397.263L39.544 903.461a52.029 52.029 0 0 0 0 73.142l2.146 2.195a51.98 51.98 0 0 0 73.143 0L511.9 581.583l397.068 397.215a51.98 51.98 0 0 0 73.143 0l2.194-2.146a52.029 52.029 0 0 0 0-73.143L587.19 506.246z" />
  </svg>
);

/** 空状态：灰色线性收纳盒，不使用背景或填充色。 */
export const Empty = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" data-tree-icon="empty-inbox">
    <path d="m17.5 17.5-7 12.5v17.5a4 4 0 0 0 4 4h35a4 4 0 0 0 4-4V30l-7-12.5h-29Z" {...strokeProps} strokeWidth="2.2" />
    <path d="M10.5 30h13l3.5 5h10l3.5-5h13M22 24h20" {...strokeProps} strokeWidth="2.2" opacity=".7" />
  </svg>
);

/** 关闭文件夹：使用与 material/文件夹.svg 一致的 iconfont 实心轮廓语言。 */
export const Folder = () => (
  <svg viewBox="0 0 1024 1024" aria-hidden="true" data-tree-icon="folder">
    <path {...nodeIconProps} fillRule="evenodd" d="M169.984 132.096h250.368c9.728 0 19.456 4.608 25.6 12.288l116.224 126.464h292.352c18.432 0 33.792 15.36 33.792 33.792v553.984c0 18.432-15.36 33.792-33.792 33.792H169.984c-18.432 0-33.792-15.36-33.792-33.792V165.888c0-18.432 15.36-33.792 33.792-33.792zm33.28 67.584v625.056h617.984V338.432h-273.92v-.512c-9.216 0-17.92-4.096-24.064-10.752L405.504 199.68h-202.24z" />
  </svg>
);

/** 打开文件夹：直接采用 material/文件夹.svg 的原始路径，仅把固定色改为主题色。 */
export const FolderOpen = () => (
  <svg viewBox="0 0 1024 1024" aria-hidden="true" data-tree-icon="folder-open">
    <path {...nodeIconProps} d="M111.104 388.096h25.088V165.888c0-18.432 15.36-33.792 33.792-33.792h250.368c9.728 0 19.456 4.608 25.6 12.288l116.224 126.464h292.352c18.432 0 33.28 14.848 33.792 33.28v83.456h25.6c18.432 0 33.28 14.848 33.28 33.28 0 2.048 0 3.584-.512 5.632l-53.248 431.616c-1.536 10.24-7.168 18.944-15.36 24.576a32.8704 32.8704 0 0 1-23.552 9.728H169.984c-8.704 0-16.896-3.072-23.04-9.216-8.704-6.144-14.336-15.36-15.872-26.112L77.824 425.472c-2.56-17.92 10.24-34.816 28.672-36.864h1.024l3.584-.512zm92.16 0h617.984v-49.664h-273.92v-.512c-9.216 0-17.92-4.096-24.064-10.752L405.504 199.68H203.264v188.416zM875.52 455.168H148.992l45.056 365.568h635.904l45.568-365.568z" />
  </svg>
);

/** 文件：直接采用 material/文件.svg 的路径，并与文件夹使用相同的外扩加粗。 */
export const File = () => (
  <svg viewBox="0 0 1024 1024" aria-hidden="true" data-tree-icon="file">
    <path {...nodeIconProps} d="M773.82 338.84 625.06 194.28v144.56zm-220.1 69.33V165.51H268.47q-15 0-25.34 10.06a33 33 0 0 0-10.31 24.61v624a32.84 32.84 0 0 0 10.31 24.61q10.29 10.05 25.34 10.05h499.2q15.08 0 25.37-10.05a33 33 0 0 0 10.27-24.61v-416zm-285.23-312h356.57l249.58 242.67v485.33c0 28.65-10.45 53.27-31.33 73.49s-46.09 30.5-75.65 30.5H268.47q-44.25 0-75.62-30.5c-20.9-20.22-31.34-44.84-31.34-73.49v-624q0-43 31.34-73.49t75.62-30.51z" />
  </svg>
);
