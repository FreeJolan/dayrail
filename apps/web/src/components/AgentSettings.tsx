import { useState } from 'react';
import { Row, Toggle } from './SettingsPrimitives';
import { isTauriRuntime } from '@/lib/versionUpdateContext';
import { setAgentEnabled, useAgentBridge } from '@/lib/agentBridge';
import { resourceDir, join } from '@tauri-apps/api/path';

export function AgentSettings() {
  const { enabled, running, error } = useAgentBridge();
  const [command, setCommand] = useState('');
  if (!isTauriRuntime()) return null;
  return (
    <section className="mb-8 rounded-lg border border-border-subtle p-5">
      <h2 className="mb-3 text-sm font-medium text-ink-primary">本地 Agent</h2>
      <Row
        label="允许本地 Agent 访问"
        description="允许本机命令读取规划数据和修改安排，改动会直接显示在应用中。删除仍需在这里确认。"
        control={
          <Toggle
            checked={enabled}
            onChange={(value) => {
              void setAgentEnabled(value);
            }}
          />
        }
      />
      <p className="mt-2 text-xs text-ink-tertiary">
        {running
          ? '已开启，应用运行期间可用。'
          : enabled
            ? '尚未连接。'
            : '已关闭。'}
      </p>
      {error && (
        <details className="mt-2 text-xs text-warn">
          <summary>查看详情</summary>
          {error}
        </details>
      )}
      <button
        className="mt-4 text-xs text-ink-secondary underline"
        onClick={async () => {
          const cli = await join(await resourceDir(), 'cli', 'dayrail.mjs');
          setCommand(`node '${cli.replaceAll("'", "'\\''")}' install`);
        }}
      >
        查看 CLI 安装命令
      </button>
      {command && (
        <p className="mt-3 break-all rounded bg-surface-1 p-3 font-mono text-xs text-ink-secondary">
          {command}
        </p>
      )}
    </section>
  );
}
