---
title: "Advanced Concurrency Control in Node.js and TypeScript"
description: "An article that takes you through the entire journey of implementing advanced concurrency control in Node.js and TypeScript."
date: 2025-07-08
---

When processing large numbers of files, API calls, or other asynchronous operations, controlling concurrency becomes crucial for performance and resource management. This guide explores how to build sophisticated concurrency control systems that can adapt to changing conditions at runtime.

## Table of Contents

1. [Understanding the Problem](#understanding-the-problem)
2. [Building a Basic Async File Iterator](#building-a-basic-async-file-iterator)
3. [Implementing Fixed Concurrency Control](#implementing-fixed-concurrency-control)
4. [Creating Dynamic Concurrency Control](#creating-dynamic-concurrency-control)
5. [Advanced Patterns and Best Practices](#advanced-patterns-and-best-practices)
6. [Real-World Applications](#real-world-applications)

## Understanding the Problem

When dealing with hundreds or thousands of asynchronous operations, running them all simultaneously can overwhelm your system, exhaust resources, or hit API rate limits. The goal is to maintain optimal throughput while respecting system constraints.

**Key challenges:**

- Memory consumption from too many concurrent operations
- Resource exhaustion (file handles, network connections)
- Rate limiting from external APIs
- Variable system load requiring dynamic adjustment
- Graceful error handling without stopping the entire process

## Building a Basic Async File Iterator

Let's start with a foundation: an async generator that recursively finds files. This pattern is memory-efficient and works well with concurrency control.

```typescript
import * as fs from "fs";
import * as path from "path";

/**
 * Generator that recursively yields all .md files in a directory
 * @param dirPath - The directory path to search
 * @yields The full path to each .md file found
 */
export async function* iterateMarkdownFiles(
  dirPath: string,
): AsyncGenerator<string, void, unknown> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        yield* iterateMarkdownFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Yield markdown files
        yield fullPath;
      }
    }
  } catch (error) {
    // Handle permission errors or other filesystem issues
    console.warn(`Warning: Could not read directory ${dirPath}:`, error);
  }
}
```

**Why async generators?**

- **Memory efficient**: Only holds one item at a time, not the entire list
- **Lazy evaluation**: Files are discovered as needed
- **Composable**: Works seamlessly with for-await loops and other async patterns
- **Cancellable**: Can be stopped at any point without processing remaining items

## Implementing Fixed Concurrency Control

The core concept is maintaining a "sliding window" of active operations. When one completes, immediately start the next one.

```typescript
/**
 * Process files from an async generator with controlled concurrency
 * @param generator - The async generator to consume
 * @param processFile - Function to process each file
 * @param concurrency - Maximum number of concurrent operations
 */
export async function processWithConcurrency<T>(
  generator: AsyncGenerator<T, void, unknown>,
  processFile: (item: T) => Promise<void>,
  concurrency: number = 10,
): Promise<void> {
  const activePromises = new Set<Promise<void>>();

  try {
    for await (const item of generator) {
      // Start processing the current item
      const promise = processFile(item).finally(() => {
        activePromises.delete(promise);
      });

      activePromises.add(promise);

      // If we've reached the concurrency limit, wait for at least one to complete
      if (activePromises.size >= concurrency) {
        await Promise.race(activePromises);
      }
    }

    // Wait for all remaining promises to complete
    await Promise.all(activePromises);
  } catch (error) {
    // Wait for all active promises to complete before throwing
    await Promise.allSettled(activePromises);
    throw error;
  }
}
```

**Key mechanisms:**

1. **Set-based tracking**: Using `Set<Promise<void>>` to track active operations
2. **Sliding window**: `Promise.race()` waits for the first completion when at capacity
3. **Automatic cleanup**: `finally()` ensures promises are removed from the set
4. **Graceful shutdown**: `Promise.allSettled()` waits for cleanup before throwing errors

**Example usage:**

```typescript
async function processMarkdownFile(filePath: string): Promise<void> {
  try {
    console.log(`📝 Processing: ${filePath}`);

    const content = await fs.promises.readFile(filePath, "utf8");

    // Your processing logic here
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));

    console.log(`✅ Completed: ${filePath} (${content.length} chars)`);
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
  }
}

// Usage
const generator = iterateMarkdownFiles("./docs");
await processWithConcurrency(generator, processMarkdownFile, 10);
```

## Creating Dynamic Concurrency Control

Real-world applications often need to adjust concurrency based on system conditions, time of day, or external factors. Here's how to build a system that can scale up and down at runtime.

### The Concurrency Controller

```typescript
/**
 * Controller for dynamic concurrency management
 */
export class ConcurrencyController {
  private _concurrency: number;
  private _checkInterval: number;
  private _onConcurrencyChange?: (oldValue: number, newValue: number) => void;

  constructor(
    initialConcurrency: number = 10,
    checkInterval: number = 1000,
    onConcurrencyChange?: (oldValue: number, newValue: number) => void,
  ) {
    this._concurrency = initialConcurrency;
    this._checkInterval = checkInterval;
    this._onConcurrencyChange = onConcurrencyChange;
  }

  get concurrency(): number {
    return this._concurrency;
  }

  set concurrency(value: number) {
    if (value < 1) throw new Error("Concurrency must be at least 1");

    const oldValue = this._concurrency;
    this._concurrency = value;

    if (this._onConcurrencyChange && oldValue !== value) {
      this._onConcurrencyChange(oldValue, value);
    }
  }

  get checkInterval(): number {
    return this._checkInterval;
  }
}
```

### Dynamic Processing Engine

```typescript
/**
 * Process files with dynamic concurrency that can change at runtime
 */
export async function processWithDynamicConcurrency<T>(
  generator: AsyncGenerator<T, void, unknown>,
  processFile: (item: T) => Promise<void>,
  controller: ConcurrencyController,
  getConcurrency?: () => number | Promise<number>,
): Promise<void> {
  const activePromises = new Set<Promise<void>>();
  let isRunning = true;

  // Function to start processing an item
  const startProcessing = (item: T) => {
    const promise = processFile(item).finally(() => {
      activePromises.delete(promise);
    });
    activePromises.add(promise);
    return promise;
  };

  // Background task to check and update concurrency
  const concurrencyChecker = async () => {
    while (isRunning) {
      try {
        if (getConcurrency) {
          const newConcurrency = await getConcurrency();
          if (newConcurrency !== controller.concurrency) {
            controller.concurrency = newConcurrency;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, controller.checkInterval));
      } catch (error) {
        console.warn("Error in concurrency checker:", error);
      }
    }
  };

  // Start the background concurrency checker
  const checkerPromise = concurrencyChecker();

  try {
    for await (const item of generator) {
      // Start processing the current item
      startProcessing(item);

      // If we've exceeded the current concurrency limit, wait for completions
      while (activePromises.size >= controller.concurrency) {
        await Promise.race(activePromises);
      }
    }

    // Wait for all remaining promises to complete
    await Promise.all(activePromises);
  } catch (error) {
    await Promise.allSettled(activePromises);
    throw error;
  } finally {
    isRunning = false;
    await checkerPromise;
  }
}
```

**Key innovations:**

1. **Background monitoring**: Separate async task continuously checks for concurrency changes
2. **Non-blocking updates**: Concurrency changes don't interrupt ongoing operations
3. **Graceful scaling**: When scaling down, simply prevents new tasks from starting
4. **Pluggable strategy**: `getConcurrency` function can implement any logic

## Advanced Patterns and Best Practices

### Time-Based Concurrency

```typescript
function timeBased(): number {
  const hour = new Date().getHours();

  // Lower concurrency during business hours
  if (hour >= 9 && hour <= 17) {
    return 5;
  }
  // Higher concurrency during off-hours
  return 15;
}
```

### System Load-Based Scaling

```typescript
async function systemLoadBasedConcurrency(): Promise<number> {
  // This would integrate with actual system monitoring
  const systemLoad = await getSystemLoad(); // Your implementation
  const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB

  if (systemLoad > 0.8 || memoryUsage > 500) {
    return 3; // High load or memory usage
  } else if (systemLoad > 0.5 || memoryUsage > 200) {
    return 8; // Medium load
  } else {
    return 15; // Low load
  }
}
```

### External Signal-Based Control

```typescript
let externalConcurrency = 10;

// Scale up on SIGUSR1
process.on("SIGUSR1", () => {
  externalConcurrency = Math.min(50, externalConcurrency * 2);
  console.log(`Scaled up to ${externalConcurrency}`);
});

// Scale down on SIGUSR2
process.on("SIGUSR2", () => {
  externalConcurrency = Math.max(1, Math.floor(externalConcurrency / 2));
  console.log(`Scaled down to ${externalConcurrency}`);
});

function signalBasedConcurrency(): number {
  return externalConcurrency;
}
```

### Error Handling and Resilience

```typescript
async function resilientProcessor(filePath: string): Promise<void> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await processFile(filePath);
      return; // Success
    } catch (error) {
      attempt++;

      if (attempt >= maxRetries) {
        console.error(`Failed after ${maxRetries} attempts: ${filePath}`, error);
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

### Progress Tracking and Monitoring

```typescript
class ProgressTracker {
  private processed = 0;
  private errors = 0;
  private startTime = Date.now();

  constructor(private total: number) {}

  onComplete() {
    this.processed++;
    this.logProgress();
  }

  onError() {
    this.errors++;
    this.logProgress();
  }

  private logProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.processed / (elapsed / 1000);
    const progress = (((this.processed + this.errors) / this.total) * 100).toFixed(1);

    console.log(
      `Progress: ${progress}% (${this.processed}/${
        this.total
      }) Rate: ${rate.toFixed(2)}/s Errors: ${this.errors}`,
    );
  }
}
```

## Real-World Applications

### Web Scraping with Rate Limiting

```typescript
async function webScrapingExample() {
  const urls = getUrlsToScrape(); // Your URL source
  const controller = new ConcurrencyController(5); // Start conservative

  // Increase concurrency if no 429 errors for 30 seconds
  let lastRateLimit = 0;

  const adaptiveConcurrency = () => {
    const timeSinceLastRateLimit = Date.now() - lastRateLimit;

    if (timeSinceLastRateLimit > 30000) {
      // 30 seconds
      return Math.min(20, controller.concurrency + 1);
    } else if (timeSinceLastRateLimit < 10000) {
      // 10 seconds
      return Math.max(1, controller.concurrency - 1);
    }

    return controller.concurrency;
  };

  await processWithDynamicConcurrency(
    asyncGenerator(urls),
    async (url) => {
      try {
        await scrapeUrl(url);
      } catch (error) {
        if (error.status === 429) {
          lastRateLimit = Date.now();
        }
        throw error;
      }
    },
    controller,
    adaptiveConcurrency,
  );
}
```

### Database Migration with Backpressure

```typescript
async function databaseMigrationExample() {
  const controller = new ConcurrencyController(10);

  // Monitor database connection pool
  const dbAwareConcurrency = async () => {
    const poolStats = await db.getPoolStats();
    const utilization = poolStats.used / poolStats.total;

    if (utilization > 0.8) {
      return 3; // High database load
    } else if (utilization > 0.5) {
      return 7; // Medium load
    } else {
      return 15; // Low load
    }
  };

  await processWithDynamicConcurrency(
    iterateRecords(),
    migrateRecord,
    controller,
    dbAwareConcurrency,
  );
}
```

### API Processing with Circuit Breaker

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

  constructor(
    private failureThreshold = 5,
    private timeout = 60000, // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker is OPEN");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = "CLOSED";
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  getConcurrency(): number {
    switch (this.state) {
      case "OPEN":
        return 0;
      case "HALF_OPEN":
        return 1;
      case "CLOSED":
        return 10;
    }
  }
}
```

## Performance Considerations

**Memory Management:**

- Use async generators instead of loading all items into memory
- Implement proper cleanup with `finally()` blocks
- Monitor heap usage in long-running processes

**CPU Usage:**

- Don't set concurrency higher than CPU cores for CPU-bound tasks
- Use `setImmediate()` or `setTimeout(0)` to yield control in tight loops
- Consider worker threads for truly CPU-intensive tasks

**Network Efficiency:**

- Implement connection pooling for HTTP requests
- Use keep-alive connections when possible
- Respect server-side rate limits and implement backoff

**Error Recovery:**

- Implement exponential backoff for transient failures
- Use circuit breakers for external service calls
- Log errors with context for debugging

## Conclusion

Building effective concurrency control requires understanding both the technical patterns and the operational requirements of your specific use case. The patterns shown here provide a foundation that can be adapted to various scenarios, from simple file processing to complex distributed systems.

Key takeaways:

- Start with simple fixed concurrency and add complexity only when needed
- Use async generators for memory-efficient data processing
- Implement monitoring and observability from the beginning
- Design for failure with proper error handling and recovery
- Test thoroughly under various load conditions

The dynamic concurrency control pattern is particularly powerful for production systems where conditions change over time, allowing your applications to automatically adapt to varying loads and maintain optimal performance.
