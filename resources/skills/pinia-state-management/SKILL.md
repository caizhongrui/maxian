---
name: Pinia State Management
slug: pinia-state-management
description: Pinia状态管理库，Vue 3官方推荐的状态管理方案，支持TypeScript、模块化、开发工具
version: 1.0.0
category: development
author: System
tags: [pinia, vue3, state-management, typescript]
estimatedTokens: 1500
---

# Pinia State Management Guide

Pinia状态管理最佳实践。

## 核心概念

### 1. 安装和配置

**安装**：
```bash
npm install pinia
```

**配置**：
```javascript
// main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.mount('#app')
```

### 2. 定义Store

**基础Store**：
```javascript
// stores/counter.js
import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', {
  // state
  state: () => ({
    count: 0,
    name: 'Counter'
  }),

  // getters
  getters: {
    doubleCount: (state) => state.count * 2,

    // 访问其他getter
    doubleCountPlusOne() {
      return this.doubleCount + 1
    },

    // 传递参数
    getUserById: (state) => {
      return (userId) => state.users.find(u => u.id === userId)
    }
  },

  // actions
  actions: {
    increment() {
      this.count++
    },

    async fetchData() {
      const response = await fetch('/api/data')
      const data = await response.json()
      this.count = data.count
    }
  }
})
```

**Setup语法**：
```javascript
// stores/counter.js
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', () => {
  // state
  const count = ref(0)
  const name = ref('Counter')

  // getters
  const doubleCount = computed(() => count.value * 2)

  // actions
  function increment() {
    count.value++
  }

  async function fetchData() {
    const response = await fetch('/api/data')
    const data = await response.json()
    count.value = data.count
  }

  return {
    count,
    name,
    doubleCount,
    increment,
    fetchData
  }
})
```

### 3. 使用Store

**在组件中使用**：
```vue
<script setup>
import { useCounterStore } from '@/stores/counter'
import { storeToRefs } from 'pinia'

const store = useCounterStore()

// ❌ 直接解构会失去响应性
const { count, name } = store

// ✅ 使用storeToRefs保持响应性
const { count, name, doubleCount } = storeToRefs(store)

// ✅ actions可以直接解构
const { increment, fetchData } = store

// 修改state
store.count++
store.$patch({ count: store.count + 1 })
store.$patch((state) => {
  state.count++
  state.name = 'New Name'
})

// 替换整个state
store.$state = { count: 10, name: 'Counter' }
</script>

<template>
  <div>
    <p>Count: {{ count }}</p>
    <p>Double: {{ doubleCount }}</p>
    <button @click="increment">增加</button>
    <button @click="fetchData">获取数据</button>
  </div>
</template>
```

### 4. TypeScript支持

**定义类型**：
```typescript
// stores/user.ts
import { defineStore } from 'pinia'

interface User {
  id: number
  name: string
  email: string
}

interface UserState {
  currentUser: User | null
  users: User[]
  loading: boolean
}

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    currentUser: null,
    users: [],
    loading: false
  }),

  getters: {
    isLoggedIn: (state): boolean => state.currentUser !== null,

    userName: (state): string => state.currentUser?.name ?? 'Guest'
  },

  actions: {
    async login(email: string, password: string): Promise<void> {
      this.loading = true
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        })
        this.currentUser = await response.json()
      } finally {
        this.loading = false
      }
    },

    logout(): void {
      this.currentUser = null
    }
  }
})
```

**Setup语法with TypeScript**：
```typescript
// stores/user.ts
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

interface User {
  id: number
  name: string
  email: string
}

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<User | null>(null)
  const users = ref<User[]>([])
  const loading = ref(false)

  const isLoggedIn = computed(() => currentUser.value !== null)
  const userName = computed(() => currentUser.value?.name ?? 'Guest')

  async function login(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      currentUser.value = await response.json()
    } finally {
      loading.value = false
    }
  }

  function logout(): void {
    currentUser.value = null
  }

  return {
    currentUser,
    users,
    loading,
    isLoggedIn,
    userName,
    login,
    logout
  }
})
```

### 5. 订阅Store变化

```vue
<script setup>
import { useCounterStore } from '@/stores/counter'

const store = useCounterStore()

// 订阅state变化
store.$subscribe((mutation, state) => {
  console.log('State changed:', mutation.type, state)

  // 持久化到localStorage
  localStorage.setItem('counter', JSON.stringify(state))
})

// 订阅action调用
store.$onAction(({
  name,      // action名称
  store,     // store实例
  args,      // 传递给action的参数
  after,     // action成功后的钩子
  onError,   // action失败的钩子
}) => {
  console.log(`Action ${name} called with args:`, args)

  after((result) => {
    console.log(`Action ${name} finished with result:`, result)
  })

  onError((error) => {
    console.error(`Action ${name} failed:`, error)
  })
})
</script>
```

### 6. 组合多个Store

```javascript
// stores/cart.js
import { defineStore } from 'pinia'
import { useUserStore } from './user'
import { useProductStore } from './product'

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: []
  }),

  getters: {
    total() {
      const productStore = useProductStore()

      return this.items.reduce((sum, item) => {
        const product = productStore.getById(item.productId)
        return sum + (product?.price ?? 0) * item.quantity
      }, 0)
    }
  },

  actions: {
    addItem(productId, quantity) {
      const userStore = useUserStore()

      if (!userStore.isLoggedIn) {
        throw new Error('请先登录')
      }

      const existingItem = this.items.find(i => i.productId === productId)

      if (existingItem) {
        existingItem.quantity += quantity
      } else {
        this.items.push({ productId, quantity })
      }
    }
  }
})
```

### 7. 插件系统

**持久化插件**：
```javascript
// plugins/persist.js
export function persistPlugin({ store }) {
  // 从localStorage恢复state
  const savedState = localStorage.getItem(store.$id)
  if (savedState) {
    store.$patch(JSON.parse(savedState))
  }

  // 订阅state变化并保存
  store.$subscribe((mutation, state) => {
    localStorage.setItem(store.$id, JSON.stringify(state))
  })
}

// main.js
import { createPinia } from 'pinia'
import { persistPlugin } from './plugins/persist'

const pinia = createPinia()
pinia.use(persistPlugin)
```

**日志插件**：
```javascript
// plugins/logger.js
export function loggerPlugin({ store }) {
  store.$onAction(({ name, args, after, onError }) => {
    const startTime = Date.now()
    console.log(`[${store.$id}] Action "${name}" called with:`, args)

    after((result) => {
      const duration = Date.now() - startTime
      console.log(`[${store.$id}] Action "${name}" finished in ${duration}ms`)
    })

    onError((error) => {
      console.error(`[${store.$id}] Action "${name}" failed:`, error)
    })
  })
}
```

### 8. 重置Store

```vue
<script setup>
import { useCounterStore } from '@/stores/counter'

const store = useCounterStore()

// 重置到初始state
const resetStore = () => {
  store.$reset()
}

// 自定义重置逻辑
const customReset = () => {
  store.$patch({
    count: 0,
    name: 'Default Name'
  })
}
</script>
```

### 9. 模块化Store

**目录结构**：
```
stores/
├── index.js          # 导出所有store
├── user.js           # 用户store
├── product.js        # 商品store
├── cart.js           # 购物车store
└── modules/
    ├── auth.js       # 认证模块
    └── settings.js   # 设置模块
```

**统一导出**：
```javascript
// stores/index.js
export { useUserStore } from './user'
export { useProductStore } from './product'
export { useCartStore } from './cart'
export { useAuthStore } from './modules/auth'
export { useSettingsStore } from './modules/settings'
```

**使用**：
```vue
<script setup>
import { useUserStore, useCartStore } from '@/stores'

const userStore = useUserStore()
const cartStore = useCartStore()
</script>
```

### 10. 测试

**Store测试**：
```javascript
// stores/__tests__/counter.spec.js
import { setActivePinia, createPinia } from 'pinia'
import { useCounterStore } from '../counter'

describe('Counter Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('increments count', () => {
    const store = useCounterStore()
    expect(store.count).toBe(0)

    store.increment()
    expect(store.count).toBe(1)
  })

  it('computes double count', () => {
    const store = useCounterStore()
    store.count = 5

    expect(store.doubleCount).toBe(10)
  })

  it('resets store', () => {
    const store = useCounterStore()
    store.count = 10

    store.$reset()
    expect(store.count).toBe(0)
  })
})
```

## 最佳实践

- [ ] Store命名使用use开头（useXxxStore）
- [ ] 一个文件定义一个Store
- [ ] State保持扁平化，避免深层嵌套
- [ ] Getter用于派生数据，Actions用于修改state
- [ ] 使用storeToRefs解构保持响应性
- [ ] TypeScript项目定义完整类型
- [ ] 使用插件处理通用逻辑（持久化、日志）
- [ ] 合理组织Store目录结构
- [ ] 编写单元测试
- [ ] 避免直接修改state，使用actions

## 常见问题

**Q: Pinia vs Vuex？**
A: Pinia更轻量、TypeScript支持更好、没有mutations、支持多store实例。

**Q: 何时使用Store？**
A: 跨组件共享的状态、需要持久化的数据、复杂的状态逻辑。

**Q: 如何处理异步？**
A: 在actions中使用async/await，getter保持同步。

遵循这些实践，高效使用Pinia进行状态管理。
