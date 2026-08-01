"""触达层（对应架构「执行回写 + 推送提醒」）

默认本地报告（LocalNotifier）；邮件推送（EmailNotifier）为架构预留，
需连接 agent-mail 连接器后启用。微信/App 推送需连接 westock / 微信连接器。
"""
from __future__ import annotations

import config
from reports import report


class LocalNotifier:
    def notify(self, result: dict, cfg: config.AppConfig) -> str:
        path = report.write_report(result, cfg)
        self._print_summary(result)
        return path

    @staticmethod
    def _print_summary(result: dict):
        meta = result["meta"]
        final = result["final"]
        fm = final["metrics"]
        print("\n" + "=" * 56)
        print(" 交易 Agent 闭环运行完成")
        print("=" * 56)
        print(f" 候选池 {meta['universe_size']} → 选出 {meta['selected_n']} 只")
        print(f" 最终信号: MA{final['signal']['fast_ma']}/MA{final['signal']['slow_ma']}"
              f"  信号总数 {final.get('n_signals_total', 0)}")
        print(f" 总收益 {fm['total_return']*100:+.2f}%  年化 {fm['annual_return']*100:+.2f}%"
              f"  夏普 {fm['sharpe']:.2f}  最大回撤 {fm['max_drawdown']*100:+.2f}%")
        if result.get("optimized"):
            bm = result["base"]["metrics"]
            imp = fm["sharpe"] - bm["sharpe"]
            print(f" 优化夏普提升 {imp:+.2f}")
        print("=" * 56 + "\n")


class EmailNotifier:
    """架构预留：连接 agent-mail 后实现邮件推送。"""

    def notify(self, result: dict, cfg: config.AppConfig) -> str:
        raise NotImplementedError(
            "邮件推送需先连接 agent-mail 连接器。当前请使用默认本地报告（--notifier local）。"
        )


def get_notifier(cfg: config.AppConfig):
    if cfg.notifier == "email":
        return EmailNotifier()
    return LocalNotifier()
