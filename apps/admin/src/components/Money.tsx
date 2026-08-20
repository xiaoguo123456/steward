import { Tooltip, Typography } from 'antd';
import type { MoneyAmount } from '@steward/admin-api-client';

/**
 * 金额展示。
 *
 * **缺价时显示「价格缺失」而不是 $0.00。** 这是整条成本链路最要紧的
 * 一条约定：0 会被读成「这次不花钱」，而实际情况是「我们不知道花了多少」。
 * 把它显示成 0，报表上的总额就会系统性偏低，而且从数字上看不出偏低。
 */
export function Money({ value }: { value?: MoneyAmount | null }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;

  switch (value.status) {
    case 'pricing_missing':
      return (
        <Tooltip title="有用量但没有配置价格，因此算不出金额。去「AI 与成本」补上价格后会自动重算。">
          <Typography.Text type="warning">价格缺失</Typography.Text>
        </Tooltip>
      );
    case 'no_usage':
      return <Typography.Text type="secondary">—</Typography.Text>;
    case 'pending':
      return <Typography.Text type="secondary">待结算</Typography.Text>;
    case 'not_applicable':
      return <Typography.Text type="secondary">不计费</Typography.Text>;
    default:
      break;
  }

  if (!value.amount) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }

  const text = `$${Number(value.amount).toFixed(4)}`;
  if (value.status === 'partial') {
    // partial 是「一部分算出来了，一部分缺价」。**金额要显示**——
    // 那部分钱是真实花掉的——但必须标出它不完整，否则会被当成全额。
    return (
      <Tooltip title="部分调用没有配置价格，这个金额只包含算得出来的那部分，实际花费更高。">
        <Typography.Text type="warning">{text} ⚠</Typography.Text>
      </Tooltip>
    );
  }
  return <Typography.Text>{text}</Typography.Text>;
}
