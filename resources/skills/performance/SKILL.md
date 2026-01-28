---
name: Performance
slug: performance
description: 性能优化策略和常见性能问题解决方案
category: performance
estimatedTokens: 1000
version: 1.0.0
author: Official
tags: [performance, optimization, profiling, caching]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Performance Skill

## 概述

系统化的性能优化方法和常见性能瓶颈解决方案。

## 性能优化流程

### 1. 测量（Measure）

**永远先测量，再优化！**

```typescript
// 使用 Performance API
console.time('operation');
performExpensiveOperation();
console.timeEnd('operation'); // operation: 234.56ms

// 使用 performance.mark
performance.mark('start');
await fetchData();
performance.mark('end');
performance.measure('fetch-duration', 'start', 'end');
const measure = performance.getEntriesByName('fetch-duration')[0];
console.log(`Fetch took ${measure.duration}ms`);
```

### 2. 分析（Profile）

```bash
# Node.js 性能分析
node --inspect app.js
# 打开 chrome://inspect

# React DevTools Profiler
# Chrome DevTools Performance tab

# Lighthouse 审计
npm install -g lighthouse
lighthouse https://example.com
```

### 3. 优化（Optimize）

只优化测量出的瓶颈！

## 常见性能问题

### 1. N+1 查询问题

```typescript
// ❌ N+1 查询（慢）
async function getPostsWithAuthors() {
  const posts = await db.query('SELECT * FROM posts');
  for (const post of posts) {
    post.author = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [post.authorId]
    ); // N 次额外查询！
  }
  return posts;
}

// ✅ 使用 JOIN（快）
async function getPostsWithAuthors() {
  return db.query(`
    SELECT posts.*, users.name as author_name
    FROM posts
    JOIN users ON posts.author_id = users.id
  `);
}

// ✅ 使用数据加载器（DataLoader）
import DataLoader from 'dataloader';

const userLoader = new DataLoader(async (ids) => {
  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);
  return ids.map(id => users.find(u => u.id === id));
});

async function getPostsWithAuthors() {
  const posts = await db.query('SELECT * FROM posts');
  for (const post of posts) {
    post.author = await userLoader.load(post.authorId); // 批量加载
  }
  return posts;
}
```

### 2. 不必要的重新渲染

```typescript
// ❌ 每次父组件渲染都会重新渲染（React）
function Parent() {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <ExpensiveChild data={data} /> {/* 每次都重新渲染 */}
    </>
  );
}

// ✅ 使用 React.memo
const ExpensiveChild = React.memo(({ data }) => {
  // 只在 data 改变时重新渲染
  return <div>{/* ... */}</div>;
});

// ✅ 使用 useMemo 缓存计算结果
function Component({ items }) {
  const expensiveValue = useMemo(() => {
    return items.reduce((acc, item) => acc + item.value, 0);
  }, [items]); // 只在 items 改变时重新计算

  return <div>{expensiveValue}</div>;
}

// ✅ 使用 useCallback 缓存函数
function Parent() {
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []); // 函数引用不变

  return <Child onClick={handleClick} />;
}
```

### 3. 内存泄漏

```typescript
// ❌ 事件监听器未清理
function Component() {
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    // 忘记清理！组件卸载后监听器仍在
  }, []);
}

// ✅ 清理副作用
function Component() {
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize); // 清理
    };
  }, []);
}

// ❌ 闭包陷阱
let cache = [];
function addToCache(item) {
  cache.push(item); // cache 永远不会被清理
}

// ✅ 使用 WeakMap（自动垃圾回收）
const cache = new WeakMap();
function addToCache(key, value) {
  cache.set(key, value); // key 被回收时，value 也会被清理
}
```

### 4. 阻塞主线程

```typescript
// ❌ 同步计算阻塞 UI
function processLargeArray(arr) {
  return arr.map(item => expensiveOperation(item)); // 阻塞！
}

// ✅ 使用 Web Worker
// worker.js
self.onmessage = (e) => {
  const result = e.data.map(item => expensiveOperation(item));
  self.postMessage(result);
};

// main.js
const worker = new Worker('worker.js');
worker.postMessage(largeArray);
worker.onmessage = (e) => {
  console.log('Result:', e.data);
};

// ✅ 分批处理（时间切片）
async function processLargeArray(arr, batchSize = 100) {
  const results = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    const batch = arr.slice(i, i + batchSize);
    results.push(...batch.map(item => expensiveOperation(item)));
    await new Promise(resolve => setTimeout(resolve, 0)); // 让出主线程
  }
  return results;
}
```

## 缓存策略

### 1. 内存缓存

```typescript
// 简单缓存
const cache = new Map();

function expensiveFunction(key) {
  if (cache.has(key)) {
    return cache.get(key);
  }
  const result = /* 昂贵计算 */;
  cache.set(key, result);
  return result;
}

// LRU 缓存（限制大小）
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value); // 移到最后
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey); // 删除最久未使用
    }
  }
}
```

### 2. HTTP 缓存

```typescript
// 设置缓存头
app.get('/api/data', (req, res) => {
  res.set({
    'Cache-Control': 'public, max-age=300', // 5 分钟
    'ETag': generateETag(data)
  });
  res.json(data);
});

// 条件请求
app.get('/api/data', (req, res) => {
  const etag = generateETag(data);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end(); // Not Modified
    return;
  }
  res.set('ETag', etag);
  res.json(data);
});
```

### 3. Redis 缓存

```typescript
import Redis from 'ioredis';
const redis = new Redis();

async function getCachedData(key) {
  // 先查缓存
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // 缓存未命中，查数据库
  const data = await db.query('SELECT * FROM ...');

  // 写入缓存（5 分钟过期）
  await redis.setex(key, 300, JSON.stringify(data));

  return data;
}
```

## 懒加载

### 1. 代码分割

```typescript
// ❌ 一次性加载所有组件
import HeavyComponent from './HeavyComponent';

// ✅ 动态导入
const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### 2. 图片懒加载

```html
<!-- ✅ 原生懒加载 -->
<img src="image.jpg" loading="lazy" alt="description">
```

```typescript
// ✅ Intersection Observer
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      observer.unobserve(img);
    }
  });
});

document.querySelectorAll('img[data-src]').forEach(img => {
  observer.observe(img);
});
```

### 3. 数据懒加载（无限滚动）

```typescript
function InfiniteList() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    loadMore();
  }, [page]);

  async function loadMore() {
    const newItems = await fetchPage(page);
    setItems([...items, ...newItems]);
  }

  return (
    <div>
      {items.map(item => <Item key={item.id} {...item} />)}
      <button onClick={() => setPage(page + 1)}>Load More</button>
    </div>
  );
}
```

## 性能检查清单

- [ ] **测量优先** - 使用 profiler 定位瓶颈
- [ ] **数据库优化** - 避免 N+1，添加索引
- [ ] **缓存策略** - 内存/Redis/HTTP 缓存
- [ ] **懒加载** - 代码分割、图片懒加载
- [ ] **避免重渲染** - React.memo、useMemo、useCallback
- [ ] **清理副作用** - 取消订阅、清理定时器
- [ ] **压缩资源** - Gzip、Brotli
- [ ] **CDN** - 静态资源使用 CDN
- [ ] **防抖/节流** - 限制高频事件处理

## 性能目标

| 指标 | 目标 |
|------|------|
| 首次内容绘制（FCP） | < 1.8s |
| 最大内容绘制（LCP） | < 2.5s |
| 首次输入延迟（FID） | < 100ms |
| 累积布局偏移（CLS） | < 0.1 |
| 总阻塞时间（TBT） | < 200ms |

## 工具推荐

- **Chrome DevTools** - Performance、Network、Memory 面板
- **Lighthouse** - 性能审计
- **React DevTools Profiler** - React 性能分析
- **webpack-bundle-analyzer** - 打包分析
- **Web Vitals** - 核心性能指标

## 参考资料

- [Web Vitals](https://web.dev/vitals/)
- [Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance)
