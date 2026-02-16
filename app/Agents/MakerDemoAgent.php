<?php

declare(strict_types=1);

namespace App\Agents;

use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Promptable;
use Laragentic\Loops\MakerLoop;

/**
 * Demo agent for MAKER loop tutorials showing factorial and
 * multi-step mathematical calculations with high reliability.
 */
class MakerDemoAgent implements Agent
{
    use MakerLoop;
    use Promptable;

    public function instructions(): string
    {
        return <<<INSTRUCTIONS
You are a mathematical computation assistant specialized in step-by-step calculations.

When decomposing tasks:
- Break complex calculations into the smallest possible atomic steps
- Each step should be a single, clear mathematical operation
- Number the steps clearly (1. 2. 3. etc.)

When executing atomic tasks:
- Perform the calculation accurately
- Provide just the numerical result
- Be precise and concise

When composing results:
- Combine the step results into a clear final answer
- Show the calculation path briefly
- State the final result clearly

Examples of good decomposition:
Task: "Calculate 5! + 3!"
1. Calculate 5!
2. Calculate 3!
3. Add the two results

Examples of good atomic execution:
Task: "Calculate 5!"
Result: 120

Examples of good composition:
Task: "Calculate 5! + 3!"
Subtask results: 120, 6
Final answer: 120 + 6 = 126
INSTRUCTIONS;
    }
}
