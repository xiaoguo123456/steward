import {
  useCreateTask,
  useCreateTaskList,
  useListTaskLists,
  useListTasks,
  useUpdateTask,
  type ShoppingCategory,
  type Task,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * 购物清单的数据层。
 *
 * 购物清单不是新的领域类型：它是 list_kind=shopping 的 TaskList，
 * 每件商品就是一条 Task。勾选就是把状态改成 done。
 *
 * 品类由服务端确定性分类，客户端不维护那套关键词——同一件东西
 * 在两台设备上必须归到同一类。
 */

/** 展示用的商品模型。它不是网络 DTO。 */
export type ShoppingListItem = {
  id: string;
  version: number;
  title: string;
  quantity: string;
  category: ShoppingCategory;
  note?: string;
  done: boolean;
  /** 来自食谱时展示来源名。 */
  sourceTitle?: string;
};

export type ShoppingDraft = {
  title: string;
  quantity: string;
  note?: string;
};

export function useShoppingList() {
  const queryClient = useQueryClient();

  const lists = useListTaskLists();
  // 购物清单只会有一个：多个同类清单会让「从食谱添加」不知道该往哪加。
  const shoppingList = lists.data?.data.find((list) => list.list_kind === 'shopping');

  const tasks = useListTasks(
    { list_id: shoppingList?.id, status: ['todo', 'doing', 'done'], limit: 100 },
    { query: { enabled: Boolean(shoppingList) } },
  );

  const invalidate = () => {
    void tasks.refetch();
    void queryClient.invalidateQueries();
  };

  const createList = useCreateTaskList();
  const createTask = useCreateTask({ mutation: { onSuccess: invalidate } });
  const updateTask = useUpdateTask({ mutation: { onSuccess: invalidate } });

  const items: ShoppingListItem[] = (tasks.data?.data ?? []).map(toItem);

  /** 确保购物清单存在。第一次用的时候才建，不在初始化时凭空造一个。 */
  const ensureList = async (): Promise<string> => {
    if (shoppingList) return shoppingList.id;
    const created = await createList.mutateAsync({
      data: { name: '购物清单', list_kind: 'shopping', icon: 'cart-outline' },
    });
    void lists.refetch();
    return created.data.id;
  };

  return {
    items,
    loading: lists.isLoading || tasks.isLoading,
    ready: Boolean(shoppingList),

    create: (draft: ShoppingDraft) => {
      void (async () => {
        const listId = await ensureList();
        createTask.mutate({
          data: {
            title: draft.title,
            list_id: listId,
            quantity_text: draft.quantity || null,
            description: draft.note || null,
          },
        });
      })();
    },

    update: (item: ShoppingListItem, draft: ShoppingDraft) => {
      updateTask.mutate({
        taskId: item.id,
        data: {
          title: draft.title,
          quantity_text: draft.quantity || null,
          description: draft.note || null,
          // 备注清空要用 clear，传 null 在 Go 那边和「没传」分不开。
          clear: draft.note ? undefined : ['description'],
        },
      });
    },

    toggle: (item: ShoppingListItem) => {
      updateTask.mutate({
        taskId: item.id,
        data: { status: item.done ? 'todo' : 'done' },
      });
    },

    pending: createTask.isPending || updateTask.isPending || createList.isPending,
  };
}

function toItem(task: Task): ShoppingListItem {
  return {
    id: task.id,
    version: task.version,
    title: task.title,
    quantity: task.quantity_text ?? '',
    category: task.shopping_category ?? 'other',
    note: task.description ?? undefined,
    done: task.status === 'done',
    sourceTitle: recipeSourceOf(task),
  };
}

/** 从来源记录里取出食谱名。来源已删除时不展示，不保留原文副本。 */
function recipeSourceOf(task: Task): string | undefined {
  const ref = task.provenance_refs?.find(
    (item) => item.source_type === 'object' && !item.source_deleted,
  );
  return ref?.part_refs?.[0];
}
