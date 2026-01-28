---
name: Vue 3 Composition API
slug: vue3-composition-api
description: Vue 3组合式API最佳实践，包含setup、响应式、生命周期、组合函数等核心概念
version: 1.0.0
category: development
author: System
tags: [vue3, composition-api, reactivity, composables]
estimatedTokens: 2000
---

# Vue 3 Composition API Guide

Vue 3组合式API开发最佳实践。

## 核心概念

### 1. setup函数

**基础用法**：
```vue
<script setup>
import { ref, computed, onMounted } from 'vue'

// 响应式数据
const count = ref(0)
const message = ref('Hello Vue 3')

// 计算属性
const doubleCount = computed(() => count.value * 2)

// 方法
const increment = () => {
  count.value++
}

// 生命周期
onMounted(() => {
  console.log('组件已挂载')
})
</script>

<template>
  <div>
    <p>{{ message }}</p>
    <p>Count: {{ count }}</p>
    <p>Double: {{ doubleCount }}</p>
    <button @click="increment">增加</button>
  </div>
</template>
```

### 2. 响应式基础

**ref vs reactive**：
```vue
<script setup>
import { ref, reactive, toRefs } from 'vue'

// ✅ ref - 基本类型
const count = ref(0)
const message = ref('Hello')

// ✅ reactive - 对象类型
const user = reactive({
  name: 'John',
  age: 30,
  address: {
    city: 'Beijing'
  }
})

// 访问ref需要.value
console.log(count.value)

// reactive直接访问
console.log(user.name)

// 解构reactive对象
const { name, age } = toRefs(user)
console.log(name.value)  // 仍然是响应式
</script>
```

**响应式工具**：
```vue
<script setup>
import { ref, isRef, unref, toRaw, markRaw } from 'vue'

const count = ref(0)

// 检查是否为ref
console.log(isRef(count))  // true

// 解包ref
console.log(unref(count))  // 0

// 获取原始对象
const user = reactive({ name: 'John' })
const rawUser = toRaw(user)

// 标记为非响应式
const nonReactiveObj = markRaw({ data: [] })
</script>
```

### 3. 计算属性

**基础计算属性**：
```vue
<script setup>
import { ref, computed } from 'vue'

const firstName = ref('John')
const lastName = ref('Doe')

// 只读计算属性
const fullName = computed(() => {
  return `${firstName.value} ${lastName.value}`
})
</script>
```

**可写计算属性**：
```vue
<script setup>
import { ref, computed } from 'vue'

const firstName = ref('John')
const lastName = ref('Doe')

const fullName = computed({
  get() {
    return `${firstName.value} ${lastName.value}`
  },
  set(newValue) {
    [firstName.value, lastName.value] = newValue.split(' ')
  }
})

// 使用
fullName.value = 'Jane Smith'
console.log(firstName.value)  // 'Jane'
console.log(lastName.value)   // 'Smith'
</script>
```

### 4. 侦听器

**watch基础用法**：
```vue
<script setup>
import { ref, watch } from 'vue'

const count = ref(0)
const message = ref('')

// 侦听单个ref
watch(count, (newValue, oldValue) => {
  console.log(`count从${oldValue}变为${newValue}`)
})

// 侦听多个源
watch([count, message], ([newCount, newMsg], [oldCount, oldMsg]) => {
  console.log('有值发生了变化')
})

// 侦听reactive对象的属性
const user = reactive({ name: 'John', age: 30 })

watch(() => user.age, (newAge, oldAge) => {
  console.log(`年龄从${oldAge}变为${newAge}`)
})
</script>
```

**watchEffect**：
```vue
<script setup>
import { ref, watchEffect } from 'vue'

const count = ref(0)
const message = ref('Hello')

// 自动追踪依赖
watchEffect(() => {
  console.log(`count: ${count.value}, message: ${message.value}`)
})

// 停止侦听
const stop = watchEffect(() => {
  console.log(count.value)
})

// 手动停止
stop()

// 清理副作用
watchEffect((onCleanup) => {
  const timer = setTimeout(() => {
    console.log(count.value)
  }, 1000)

  onCleanup(() => {
    clearTimeout(timer)
  })
})
</script>
```

**侦听器配置**：
```vue
<script setup>
import { ref, watch } from 'vue'

const user = reactive({ name: 'John' })

// 深度侦听
watch(user, (newValue) => {
  console.log('user changed:', newValue)
}, { deep: true })

// 立即执行
watch(count, (value) => {
  console.log(value)
}, { immediate: true })

// 刷新时机
watch(count, (value) => {
  console.log(value)
}, { flush: 'post' })  // 'pre' | 'post' | 'sync'
</script>
```

### 5. 生命周期钩子

```vue
<script setup>
import {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted,
  onErrorCaptured,
  onActivated,
  onDeactivated
} from 'vue'

// 挂载前
onBeforeMount(() => {
  console.log('组件即将挂载')
})

// 挂载后
onMounted(() => {
  console.log('组件已挂载')
  // DOM操作、发起请求等
})

// 更新前
onBeforeUpdate(() => {
  console.log('组件即将更新')
})

// 更新后
onUpdated(() => {
  console.log('组件已更新')
})

// 卸载前
onBeforeUnmount(() => {
  console.log('组件即将卸载')
  // 清理定时器、事件监听等
})

// 卸载后
onUnmounted(() => {
  console.log('组件已卸载')
})

// keep-alive组件激活
onActivated(() => {
  console.log('组件被激活')
})

// keep-alive组件停用
onDeactivated(() => {
  console.log('组件被停用')
})

// 错误捕获
onErrorCaptured((err, instance, info) => {
  console.error('捕获错误:', err, info)
  return false  // 阻止错误继续传播
})
</script>
```

### 6. 组合函数 (Composables)

**useCounter示例**：
```javascript
// composables/useCounter.js
import { ref, computed } from 'vue'

export function useCounter(initialValue = 0) {
  const count = ref(initialValue)

  const doubleCount = computed(() => count.value * 2)

  function increment() {
    count.value++
  }

  function decrement() {
    count.value--
  }

  function reset() {
    count.value = initialValue
  }

  return {
    count,
    doubleCount,
    increment,
    decrement,
    reset
  }
}

// 使用
<script setup>
import { useCounter } from '@/composables/useCounter'

const { count, doubleCount, increment, decrement, reset } = useCounter(10)
</script>
```

**useFetch示例**：
```javascript
// composables/useFetch.js
import { ref, watchEffect, toValue } from 'vue'

export function useFetch(url) {
  const data = ref(null)
  const error = ref(null)
  const loading = ref(false)

  const fetchData = async () => {
    loading.value = true
    data.value = null
    error.value = null

    try {
      const urlValue = toValue(url)  // 支持ref和普通值
      const response = await fetch(urlValue)
      data.value = await response.json()
    } catch (err) {
      error.value = err
    } finally {
      loading.value = false
    }
  }

  watchEffect(() => {
    fetchData()
  })

  return { data, error, loading, refetch: fetchData }
}

// 使用
<script setup>
import { ref } from 'vue'
import { useFetch } from '@/composables/useFetch'

const userId = ref(1)
const url = computed(() => `/api/users/${userId.value}`)
const { data, error, loading, refetch } = useFetch(url)
</script>

<template>
  <div v-if="loading">加载中...</div>
  <div v-else-if="error">错误: {{ error.message }}</div>
  <div v-else-if="data">{{ data }}</div>
  <button @click="refetch">刷新</button>
</template>
```

**useLocalStorage示例**：
```javascript
// composables/useLocalStorage.js
import { ref, watch } from 'vue'

export function useLocalStorage(key, defaultValue) {
  const storedValue = localStorage.getItem(key)
  const data = ref(storedValue ? JSON.parse(storedValue) : defaultValue)

  watch(data, (newValue) => {
    localStorage.setItem(key, JSON.stringify(newValue))
  }, { deep: true })

  return data
}

// 使用
<script setup>
import { useLocalStorage } from '@/composables/useLocalStorage'

const user = useLocalStorage('user', { name: '', email: '' })
</script>
```

### 7. Props和Emits

**defineProps和defineEmits**：
```vue
<script setup>
import { computed } from 'vue'

// 定义props
const props = defineProps({
  title: {
    type: String,
    required: true
  },
  count: {
    type: Number,
    default: 0
  },
  user: {
    type: Object,
    default: () => ({})
  }
})

// 使用TypeScript定义props
interface Props {
  title: string
  count?: number
}

const props = withDefaults(defineProps<Props>(), {
  count: 0
})

// 定义emits
const emit = defineEmits(['update', 'delete'])

// 使用TypeScript定义emits
const emit = defineEmits<{
  update: [value: number]
  delete: [id: string]
}>()

// 触发事件
const handleUpdate = () => {
  emit('update', props.count + 1)
}

const handleDelete = () => {
  emit('delete', 'id-123')
}

// 计算属性基于props
const doubleCount = computed(() => props.count * 2)
</script>
```

### 8. 依赖注入

**Provide/Inject**：
```vue
<!-- 父组件 -->
<script setup>
import { ref, provide } from 'vue'

const theme = ref('dark')
const updateTheme = (newTheme) => {
  theme.value = newTheme
}

// 提供数据
provide('theme', theme)
provide('updateTheme', updateTheme)

// 使用Symbol键
const ThemeSymbol = Symbol()
provide(ThemeSymbol, theme)
</script>

<!-- 子组件 -->
<script setup>
import { inject } from 'vue'

// 注入数据
const theme = inject('theme')
const updateTheme = inject('updateTheme')

// 提供默认值
const user = inject('user', { name: 'Guest' })

// 使用Symbol键
const ThemeSymbol = Symbol()
const theme = inject(ThemeSymbol)
</script>
```

### 9. 模板引用

```vue
<script setup>
import { ref, onMounted } from 'vue'

// 单个元素引用
const inputRef = ref(null)

onMounted(() => {
  inputRef.value.focus()
})

// 列表元素引用
const listRefs = ref([])

const setItemRef = (el) => {
  if (el) {
    listRefs.value.push(el)
  }
}

onMounted(() => {
  console.log(listRefs.value)
})

// 组件引用
const childRef = ref(null)

const callChildMethod = () => {
  childRef.value.someMethod()
}
</script>

<template>
  <input ref="inputRef" />

  <ul>
    <li v-for="item in items" :key="item" :ref="setItemRef">
      {{ item }}
    </li>
  </ul>

  <ChildComponent ref="childRef" />
  <button @click="callChildMethod">调用子组件方法</button>
</template>
```

### 10. defineExpose

```vue
<!-- 子组件 -->
<script setup>
import { ref } from 'vue'

const count = ref(0)
const message = ref('Hello')

const increment = () => {
  count.value++
}

// 暴露给父组件
defineExpose({
  count,
  increment
})
</script>

<!-- 父组件 -->
<script setup>
import { ref } from 'vue'

const childRef = ref(null)

const handleClick = () => {
  console.log(childRef.value.count)
  childRef.value.increment()
}
</script>

<template>
  <ChildComponent ref="childRef" />
  <button @click="handleClick">访问子组件</button>
</template>
```

## 最佳实践

- [ ] 优先使用`<script setup>`语法
- [ ] ref用于基本类型，reactive用于对象
- [ ] 解构reactive对象使用toRefs
- [ ] 抽取可复用逻辑为组合函数
- [ ] 组合函数以use开头命名
- [ ] 使用computed缓存计算结果
- [ ] 避免在模板中使用复杂表达式
- [ ] 使用watchEffect自动追踪依赖
- [ ] defineProps和defineEmits使用TypeScript
- [ ] 合理使用生命周期钩子

## 常见问题

**Q: 何时使用ref，何时使用reactive？**
A: 基本类型用ref，对象类型推荐reactive。ref需要.value访问。

**Q: 组合函数和mixins的区别？**
A: 组合函数更清晰、可追溯，没有命名冲突问题，支持TypeScript。

**Q: watch vs watchEffect的选择？**
A: 需要访问旧值或精确控制依赖用watch，简单场景用watchEffect。

遵循这些实践，充分发挥Vue 3 Composition API的优势。
