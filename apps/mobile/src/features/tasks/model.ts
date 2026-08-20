/**
 * TaskRow 需要的展示模型。
 *
 * 它不是网络 DTO：契约里的 Task 带着状态机、版本、来源这些行内不需要的东西，
 * 而列表行只关心「显示成什么样」。各个页面从契约类型映射到这里，
 * 于是同一个行组件能同时服务今天、清单、项目详情几个来源不同的列表。
 */
export type TaskItem = {
  id: string;
  title: string;
  list: string;
  time: string;
  color: string;
  // 与契约 TaskPriority 保持一致：normal 是默认优先级。
  priority?: 'high' | 'normal' | 'low';
  completed?: boolean;
};
