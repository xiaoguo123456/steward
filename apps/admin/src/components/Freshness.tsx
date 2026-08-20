import { Alert, Tag } from 'antd';
import type { DataFreshness } from '@steward/admin-api-client';

/**
 * 数据新鲜度。
 *
 * 后台的跨用户统计走的是每小时聚合的读模型，不是实时查询。
 * **不把这件事说出来的话，一个还没聚合的今天会被读成「今天没人用」**——
 * 那是最容易让人做出错误判断的一种错。
 */
export function Freshness({ value }: { value?: DataFreshness }) {
  if (!value) return null;

  const asOf = value.data_as_of
    ? new Date(value.data_as_of).toLocaleString('zh-CN')
    : '还没有';

  switch (value.aggregation_status) {
    case 'fresh':
      return <Tag color="green">数据截至 {asOf}</Tag>;
    case 'stale':
      return (
        <Alert
          type="warning"
          showIcon
          message={`数据可能已经过时（截至 ${asOf}）`}
          description="聚合任务超过两小时没有成功运行。页面上的数字还能看，但别拿它做需要时效的判断。"
        />
      );
    case 'failed':
      return (
        <Alert
          type="error"
          showIcon
          message="上一次聚合失败"
          description={`当前显示的是 ${asOf} 的数据。`}
        />
      );
    default:
      return (
        <Alert
          type="info"
          showIcon
          message="聚合还没有跑过"
          description="后台的统计来自每小时的聚合任务。它还没有产出过结果，因此这里暂时没有数据——这不等于「没有用户在用」。"
        />
      );
  }
}
