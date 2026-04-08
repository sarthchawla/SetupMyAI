---
description: Backend-specific rules for Kotlin/Ktor server development.
alwaysApply: false
---

## Architecture Patterns

- Follow Controller -> Service -> Repository pattern
- Use Koin for dependency injection
- Apply functional programming with Either and fold
- Implement proper error handling with structured response wrappers

## Kotlin Style

- Use official Kotlin code style
- Prefer data classes for DTOs and models
- Use nullable types appropriately
- Apply destructuring and extension functions where beneficial

## API Development

- Follow existing OpenAPI/Swagger documentation patterns
- Use proper HTTP status codes and response formats
- Implement input validation in controllers
- Apply consistent error response formatting

## Database & External APIs

- Use existing repository patterns for data access
- Follow stored procedure calling conventions
- Implement proper connection management
- Use retry mechanisms for external API calls

## Testing

- Write unit tests for all new controllers and services
- Use MockK for mocking dependencies
- Follow existing test structure and naming conventions
- Ensure proper test coverage with JaCoCo reports
- **ALWAYS run after adding or modifying tests:** `./gradlew test && ./gradlew detekt && ./gradlew detektFormat`

## Module Structure

- `api/` - REST controllers and routing
- `business-logic/` - Core business services
- `external-api/` - Third-party integrations
- `common/` - Shared utilities and models

## Common Commands

- `./gradlew build` - Build all modules
- `./gradlew :api:test` - Run API tests
- `./gradlew :api:jacocoTestReport` - Generate coverage
- `./gradlew :api:run` - Start development server

## Error Handling

- Apply proper logging with SLF4J
- Return meaningful error messages in response wrappers
- Handle exceptions gracefully with try-catch blocks

## Dependencies

- Prefer existing libraries over adding new ones
- Use Ktor for HTTP server and client functionality
- Apply Koin scopes appropriately (single, scope, factory)
- Follow existing configuration patterns with Typesafe Config
