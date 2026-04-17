import { MoreHorizontal, Copy, Trash2, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/DropdownMenu';

// ERD §5.4 E7: the row-level `⋯` menu on each Rail card.
//   Delete Rail · Duplicate Rail · Set default Line… · Show on check-in strip

interface Props {
  showInCheckin: boolean;
  defaultLineName: string | null;
  onToggleCheckin: (next: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEditLine: () => void;
}

export function RowMenu({
  showInCheckin,
  defaultLineName,
  onToggleCheckin,
  onDelete,
  onDuplicate,
  onEditLine,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Rail row menu"
          className="rounded-sm p-1 text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary data-[state=open]:bg-surface-2 data-[state=open]:text-ink-primary"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>属性</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onEditLine}>
          <Link2 className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.8} />
          <span className="flex-1">默认 Line</span>
          <span className="font-mono text-2xs text-ink-tertiary">
            {defaultLineName ?? '未设'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={showInCheckin}
          onCheckedChange={onToggleCheckin}
        >
          <span className="flex-1">在 check-in 条显示</span>
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>操作</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.8} />
          复制 Rail
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} destructive>
          <Trash2 className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.8} />
          删除 Rail
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
