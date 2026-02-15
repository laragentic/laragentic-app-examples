<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class CalculatorTool implements Tool
{
    public function name(): string
    {
        return 'calculate';
    }

    public function description(): Stringable|string
    {
        return 'Perform mathematical calculations. Supports basic arithmetic operations: addition (+), subtraction (-), multiplication (*), division (/), and parentheses for grouping.';
    }

    public function handle(Request $request): Stringable|string
    {
        $expression = $request['expression'] ?? '';

        // Remove whitespace and validate
        $expression = str_replace(' ', '', $expression);

        // Security: Only allow numbers, operators, parentheses, and decimal points
        if (! preg_match('/^[0-9+\-*\/().]+$/', $expression)) {
            return "Error: Invalid expression. Only numbers and basic operators (+, -, *, /) are allowed.";
        }

        try {
            // Evaluate the expression safely
            $result = $this->evaluate($expression);

            if ($result === false) {
                return "Error: Could not evaluate the expression '{$expression}'. Please check the syntax.";
            }

            return "The result of {$expression} is {$result}";
        } catch (\Throwable $e) {
            return "Error calculating '{$expression}': ".$e->getMessage();
        }
    }

    /**
     * Safely evaluate a mathematical expression
     */
    protected function evaluate(string $expression): float|false
    {
        // Remove any potential dangerous code
        $expression = preg_replace('/[^0-9+\-*\/().]/', '', $expression);

        if (empty($expression)) {
            return false;
        }

        try {
            // Use a safe evaluation approach
            $result = eval("return ({$expression});");

            return is_numeric($result) ? (float) $result : false;
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'expression' => $schema->string()
                ->description('The mathematical expression to calculate (e.g., "2 + 2", "(10 + 5) * 3", "100 / 4")')
                ->required(),
        ];
    }
}
