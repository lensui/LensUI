import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: unknown) => void;
  /** 任一依赖变化后清除旧错误，允许数据或渲染器修复后自动恢复。 */
  resetKeys?: readonly unknown[];
}
interface State { error: Error | undefined }

/** 将用户渲染函数的异常隔离在组件内，避免破坏整个页面。 */
export class TreeErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.onError?.(error); }
  componentDidUpdate(previous: Props) {
    if (!this.state.error) return;
    const before = previous.resetKeys ?? [];
    const after = this.props.resetKeys ?? [];
    if (before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]))) {
      this.setState({ error: undefined });
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    if (typeof this.props.fallback === 'function') return this.props.fallback(this.state.error);
    return this.props.fallback ?? <div role="alert" className="rc-tree__error">Tree rendering failed.</div>;
  }
}
