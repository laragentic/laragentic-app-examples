<?php

namespace App\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

class WeatherTool implements Tool
{
    public function name(): string
    {
        return 'get_weather';
    }

    public function description(): Stringable|string
    {
        return 'Get the current weather conditions for a given city. Returns temperature, conditions, humidity, and wind speed.';
    }

    public function handle(Request $request): Stringable|string
    {
        $city = $request['city'] ?? 'Unknown';

        // Mock weather data for demo purposes
        $cities = [
            'tokyo' => ['temp' => 22, 'condition' => 'Partly Cloudy', 'humidity' => 65, 'wind' => '12 km/h NE'],
            'london' => ['temp' => 14, 'condition' => 'Rainy', 'humidity' => 85, 'wind' => '20 km/h SW'],
            'new york' => ['temp' => 18, 'condition' => 'Sunny', 'humidity' => 50, 'wind' => '8 km/h W'],
            'paris' => ['temp' => 16, 'condition' => 'Overcast', 'humidity' => 72, 'wind' => '15 km/h N'],
            'sydney' => ['temp' => 26, 'condition' => 'Clear', 'humidity' => 55, 'wind' => '10 km/h SE'],
        ];

        $key = strtolower(trim($city));
        $data = $cities[$key] ?? [
            'temp' => rand(10, 30),
            'condition' => ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy', 'Clear'][array_rand(['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy', 'Clear'])],
            'humidity' => rand(30, 90),
            'wind' => rand(5, 25).' km/h',
        ];

        return "Weather in {$city}: {$data['condition']}, {$data['temp']}°C, Humidity: {$data['humidity']}%, Wind: {$data['wind']}";
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'city' => $schema->string()
                ->description('The city name to get weather for, e.g. "Tokyo", "London"')
                ->required(),
        ];
    }
}
