import { MoreHorizontal, Copy, Trash2 } from 'lucide-react';
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
//   Delete Rail · Duplicate Rail · Show on check-in strip
//
// v0.4: the old "Set default Line" entry was removed with
// Rail.defaultLineId. Habit ↔ Rail relationships live in HabitBinding
// and are edited from the habit detail page (§5.5.0).

interface Props {
  showInCheckin: boolean;
  onToggleCheckin: (next: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function RowMenu({
  showInCheckin,
  onToggleCheckin,
  onDelete,
  onDuplicate,
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
