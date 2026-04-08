---
name: nodejs-backend-patterns
description: Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handling, authentication, database integration, and API design best practices. Use when creating Node.js servers, REST APIs, GraphQL backends, or microservices architectures.
---

# Node.js Backend Patterns

Comprehensive guidance for building scalable, maintainable, and production-ready Node.js backend applications with modern frameworks, architectural patterns, and best practices.

## When to Use This Skill

- Building REST APIs or GraphQL servers
- Creating microservices with Node.js
- Implementing authentication and authorization
- Designing scalable backend architectures
- Setting up middleware and error handling
- Integrating databases (SQL and NoSQL)
- Building real-time applications with WebSockets
- Implementing background job processing

## Core Frameworks

### Express.js - Minimalist Framework

**Basic Setup:**

```typescript
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") }));
app.use(compression());

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Fastify - High Performance Framework

**Basic Setup:**

```typescript
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  },
});

await fastify.register(helmet);
await fastify.register(cors, { origin: true });
await fastify.register(compress);

await fastify.listen({ port: 3000, host: "0.0.0.0" });
```

## Architectural Patterns

### Pattern 1: Layered Architecture

```
src/
  controllers/     # Handle HTTP requests/responses
  services/        # Business logic
  repositories/    # Data access layer
  models/          # Data models
  middleware/      # Express/Fastify middleware
  routes/          # Route definitions
  utils/           # Helper functions
  config/          # Configuration
  types/           # TypeScript types
```

### Pattern 2: Dependency Injection

Use a DI container to manage service dependencies, making code testable and maintainable.

## Middleware Patterns

- **Authentication**: JWT verification, session management
- **Validation**: Zod/Joi schema validation on request body/params
- **Rate Limiting**: Redis-backed rate limiting per IP/user
- **Logging**: Structured logging with Pino/Winston

## Error Handling

Use custom error classes with proper HTTP status codes:

```typescript
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public errors?: any[]) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
  }
}
```

## Database Patterns

- **PostgreSQL**: Connection pooling with `pg`
- **MongoDB**: Mongoose with proper indexes
- **Transactions**: Use client-level transactions for multi-step operations

## Caching Strategies

- **Redis**: LRU cache with TTL for frequently accessed data
- **Cache Invalidation**: Pattern-based key invalidation

## API Response Format

```typescript
// Success
{ status: "success", message: "...", data: { ... } }

// Error
{ status: "error", message: "...", errors: [...] }

// Paginated
{ status: "success", data: [...], pagination: { page, limit, total, pages } }
```

## Best Practices

1. **Use TypeScript**: Type safety prevents runtime errors
2. **Implement proper error handling**: Use custom error classes
3. **Validate input**: Use libraries like Zod or Joi
4. **Use environment variables**: Never hardcode secrets
5. **Implement logging**: Use structured logging (Pino, Winston)
6. **Add rate limiting**: Prevent abuse
7. **Use HTTPS**: Always in production
8. **Implement CORS properly**: Don't use `*` in production
9. **Use dependency injection**: Easier testing and maintenance
10. **Write tests**: Unit, integration, and E2E tests
11. **Handle graceful shutdown**: Clean up resources
12. **Use connection pooling**: For databases
13. **Implement health checks**: For monitoring
14. **Use compression**: Reduce response size
15. **Monitor performance**: Use APM tools

## Resources

- **Node.js Best Practices**: https://github.com/goldbergyoni/nodebestpractices
- **Express.js Guide**: https://expressjs.com/en/guide/
- **Fastify Documentation**: https://www.fastify.io/docs/
