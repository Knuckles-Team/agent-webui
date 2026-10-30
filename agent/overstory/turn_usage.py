"""Strict display boundary for Arbora's caller-bound A2A turn receipt.

The public SDK does not yet expose this receipt. These fields mirror Arbora's
``a2a.run_usage`` projection; no accounting or authorization happens here.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

UsageCounter = Literal[
    'requests', 'tool_calls', 'input_tokens', 'output_tokens', 'total_tokens'
]
UsageCount = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]


class TurnUsageReceipt(BaseModel):
    """Only measured counts, with their explicit returned task/run binding."""

    model_config = ConfigDict(extra='forbid', strict=True)
    run_id: str = Field(alias='runId', min_length=1, max_length=128)
    task_id: str = Field(alias='taskId', min_length=1, max_length=80)
    context_id: str = Field(alias='contextId', min_length=1, max_length=1024)
    scope: Literal['turn']
    counts: dict[UsageCounter, UsageCount]


def bound_turn_usage(
    value: Any, *, task_id: str, context_id: str, run_id: str | None
) -> dict[str, Any] | None:
    """Discard the whole receipt on invalid data, never repair or infer counts."""
    try:
        receipt = TurnUsageReceipt.model_validate(value)
    except ValidationError:
        return None
    if (receipt.task_id, receipt.context_id, receipt.run_id) != (
        task_id,
        context_id,
        run_id,
    ):
        return None
    return receipt.model_dump(by_alias=True)
