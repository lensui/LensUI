import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolvedTreeNodeData as TreeNodeData } from '../types.js';
import { keyId } from '../utils/tree.js';
import type { ResolvedTreeProps } from '../components/treeConfig.js';

/** 管理单节点异步加载、硬超时、重复请求去重和卸载清理。 */
export function useTreeAsyncLoad(getLatestProps: () => ResolvedTreeProps) {
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const loadingKeysRef = useRef<Set<string>>(new Set());
  const controllersRef = useRef(new Map<string, AbortController>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      loadingKeysRef.current.clear();
    };
  }, []);

  const load = useCallback(async (node: TreeNodeData) => {
    const initialProps = getLatestProps();
    if (!initialProps.loadData) return;
    const id = keyId(node.key);
    if (loadingKeysRef.current.has(id)) return;

    const controller = new AbortController();
    loadingKeysRef.current.add(id);
    controllersRef.current.set(id, controller);
    setLoadingKeys(new Set(loadingKeysRef.current));

    let timeout: number | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        const error = new Error('Tree node loading timed out');
        controller.abort(error);
        reject(error);
      }, initialProps.loadTimeout ?? 10_000);
    });

    try {
      const children = await Promise.race([initialProps.loadData(node, controller.signal), timeoutPromise]);
      if (controllersRef.current.get(id) === controller && !controller.signal.aborted) {
        getLatestProps().onLoad?.(node, Array.isArray(children) ? children : undefined);
      }
    } catch (error) {
      if (controllersRef.current.get(id) === controller) getLatestProps().onLoadError?.(error, node);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (controllersRef.current.get(id) === controller) {
        controllersRef.current.delete(id);
        loadingKeysRef.current.delete(id);
        if (mountedRef.current) setLoadingKeys(new Set(loadingKeysRef.current));
      }
    }
  }, [getLatestProps]);

  return { load, loadingKeys };
}
