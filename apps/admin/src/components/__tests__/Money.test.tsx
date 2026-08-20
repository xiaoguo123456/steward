import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from '../Money';

/**
 * 金额展示的测试。
 *
 * 守的是整条成本链路最要紧的一条约定：**缺价显示「价格缺失」，不是 $0.00。**
 * 显示成 0 的话，报表上的总额会系统性偏低，而且从数字上看不出偏低。
 */
describe('Money', () => {
  it('缺价时显示「价格缺失」而不是 0', () => {
    render(<Money value={{ amount: null, currency: 'USD', status: 'pricing_missing' }} />);
    expect(screen.getByText('价格缺失')).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('算好的金额正常显示', () => {
    render(<Money value={{ amount: '2.381245', currency: 'USD', status: 'calculated' }} />);
    expect(screen.getByText('$2.3812')).toBeInTheDocument();
  });

  it('partial 时显示金额但标出不完整', () => {
    // 那部分钱是真实花掉的，不能因为不完整就丢掉；
    // 但也不能让人以为它是全额。
    render(<Money value={{ amount: '0.01081', currency: 'USD', status: 'partial' }} />);
    expect(screen.getByText(/0\.0108/)).toBeInTheDocument();
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });

  it('没有用量时显示破折号', () => {
    render(<Money value={{ amount: null, currency: 'USD', status: 'no_usage' }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('值缺失时不崩', () => {
    render(<Money value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
