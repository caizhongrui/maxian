---
name: Element Plus UI
slug: element-plus
description: Element Plus组件库使用指南，涵盖表单、表格、布局、导航等常用组件
version: 1.0.0
category: development
author: System
tags: [element-plus, vue3, ui-components, design-system]
estimatedTokens: 1500
---

# Element Plus UI Guide

Element Plus组件库最佳实践。

## 安装和配置

**安装**：
```bash
npm install element-plus @element-plus/icons-vue
```

**全局引入**：
```javascript
// main.js
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'

const app = createApp(App)

app.use(ElementPlus, {
  locale: zhCn,
  size: 'default',  // small | default | large
  zIndex: 3000
})

app.mount('#app')
```

**按需引入**：
```javascript
// vite.config.js
import { defineConfig } from 'vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
})
```

## 常用组件

### 1. 表单组件

**基础表单**：
```vue
<template>
  <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
    <el-form-item label="用户名" prop="username">
      <el-input v-model="form.username" placeholder="请输入用户名" />
    </el-form-item>

    <el-form-item label="密码" prop="password">
      <el-input
        v-model="form.password"
        type="password"
        placeholder="请输入密码"
        show-password
      />
    </el-form-item>

    <el-form-item label="邮箱" prop="email">
      <el-input v-model="form.email" placeholder="请输入邮箱" />
    </el-form-item>

    <el-form-item label="年龄" prop="age">
      <el-input-number v-model="form.age" :min="1" :max="120" />
    </el-form-item>

    <el-form-item label="性别" prop="gender">
      <el-radio-group v-model="form.gender">
        <el-radio label="male">男</el-radio>
        <el-radio label="female">女</el-radio>
      </el-radio-group>
    </el-form-item>

    <el-form-item label="爱好" prop="hobbies">
      <el-checkbox-group v-model="form.hobbies">
        <el-checkbox label="reading">阅读</el-checkbox>
        <el-checkbox label="sports">运动</el-checkbox>
        <el-checkbox label="music">音乐</el-checkbox>
      </el-checkbox-group>
    </el-form-item>

    <el-form-item label="城市" prop="city">
      <el-select v-model="form.city" placeholder="请选择城市">
        <el-option label="北京" value="beijing" />
        <el-option label="上海" value="shanghai" />
        <el-option label="深圳" value="shenzhen" />
      </el-select>
    </el-form-item>

    <el-form-item label="日期" prop="date">
      <el-date-picker
        v-model="form.date"
        type="date"
        placeholder="选择日期"
      />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" @click="submitForm">提交</el-button>
      <el-button @click="resetForm">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'

const formRef = ref(null)

const form = reactive({
  username: '',
  password: '',
  email: '',
  age: null,
  gender: '',
  hobbies: [],
  city: '',
  date: ''
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '长度在 3 到 20 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  age: [
    { required: true, message: '请输入年龄', trigger: 'change' }
  ]
}

const submitForm = async () => {
  if (!formRef.value) return

  await formRef.value.validate((valid) => {
    if (valid) {
      console.log('提交表单:', form)
      ElMessage.success('提交成功')
    } else {
      ElMessage.error('请检查表单')
    }
  })
}

const resetForm = () => {
  formRef.value?.resetFields()
}
</script>
```

### 2. 表格组件

**基础表格**：
```vue
<template>
  <el-table
    :data="tableData"
    style="width: 100%"
    stripe
    border
    @selection-change="handleSelectionChange"
  >
    <el-table-column type="selection" width="55" />
    <el-table-column type="index" label="序号" width="80" />

    <el-table-column prop="name" label="姓名" width="120" />
    <el-table-column prop="email" label="邮箱" width="200" />
    <el-table-column prop="age" label="年龄" width="80" sortable />

    <el-table-column prop="status" label="状态" width="100">
      <template #default="{ row }">
        <el-tag :type="row.status === 'active' ? 'success' : 'info'">
          {{ row.status === 'active' ? '激活' : '禁用' }}
        </el-tag>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="200" fixed="right">
      <template #default="{ row }">
        <el-button size="small" @click="handleEdit(row)">编辑</el-button>
        <el-button
          size="small"
          type="danger"
          @click="handleDelete(row)"
        >
          删除
        </el-button>
      </template>
    </el-table-column>
  </el-table>

  <el-pagination
    v-model:current-page="currentPage"
    v-model:page-size="pageSize"
    :total="total"
    :page-sizes="[10, 20, 50, 100]"
    layout="total, sizes, prev, pager, next, jumper"
    @size-change="handleSizeChange"
    @current-change="handleCurrentChange"
  />
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const tableData = ref([])
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)

const fetchData = async () => {
  // 模拟API调用
  const response = await fetch(`/api/users?page=${currentPage.value}&size=${pageSize.value}`)
  const data = await response.json()
  tableData.value = data.items
  total.value = data.total
}

const handleEdit = (row) => {
  console.log('编辑:', row)
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该用户吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    // 执行删除
    await fetch(`/api/users/${row.id}`, { method: 'DELETE' })
    ElMessage.success('删除成功')
    fetchData()
  } catch {
    ElMessage.info('已取消删除')
  }
}

const handleSelectionChange = (selection) => {
  console.log('选中的行:', selection)
}

const handleSizeChange = () => {
  fetchData()
}

const handleCurrentChange = () => {
  fetchData()
}

onMounted(() => {
  fetchData()
})
</script>
```

### 3. 对话框

```vue
<template>
  <el-button @click="dialogVisible = true">打开对话框</el-button>

  <el-dialog
    v-model="dialogVisible"
    title="用户信息"
    width="600px"
    :before-close="handleClose"
  >
    <el-form :model="dialogForm" label-width="100px">
      <el-form-item label="用户名">
        <el-input v-model="dialogForm.username" />
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="dialogForm.email" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'

const dialogVisible = ref(false)

const dialogForm = reactive({
  username: '',
  email: ''
})

const handleClose = (done) => {
  ElMessageBox.confirm('确定关闭对话框吗？')
    .then(() => {
      done()
    })
    .catch(() => {
      // 取消关闭
    })
}

const handleConfirm = () => {
  console.log('提交:', dialogForm)
  dialogVisible.value = false
  ElMessage.success('操作成功')
}
</script>
```

### 4. 消息提示

```vue
<script setup>
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'

// 消息提示
const showMessage = () => {
  ElMessage({
    message: '这是一条消息',
    type: 'success',
    duration: 3000
  })

  ElMessage.success('成功消息')
  ElMessage.warning('警告消息')
  ElMessage.error('错误消息')
  ElMessage.info('信息消息')
}

// 确认框
const showConfirm = async () => {
  try {
    await ElMessageBox.confirm('确定要执行此操作吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    ElMessage.success('已确认')
  } catch {
    ElMessage.info('已取消')
  }
}

// 提示框
const showAlert = () => {
  ElMessageBox.alert('这是一段内容', '标题', {
    confirmButtonText: '确定'
  })
}

// 输入框
const showPrompt = async () => {
  try {
    const { value } = await ElMessageBox.prompt('请输入邮箱', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /[\w!#$%&'*+/=?^_`{|}~-]+(?:\.[\w!#$%&'*+/=?^_`{|}~-]+)*@(?:[\w](?:[\w-]*[\w])?\.)+[\w](?:[\w-]*[\w])?/,
      inputErrorMessage: '邮箱格式不正确'
    })
    ElMessage.success(`你输入的是: ${value}`)
  } catch {
    ElMessage.info('取消输入')
  }
}

// 通知
const showNotification = () => {
  ElNotification({
    title: '成功',
    message: '这是一条成功的提示消息',
    type: 'success',
    position: 'top-right',
    duration: 4500
  })
}
</script>
```

### 5. 布局组件

```vue
<template>
  <!-- 24栅格布局 -->
  <el-row :gutter="20">
    <el-col :span="6">
      <div class="grid-content">span: 6</div>
    </el-col>
    <el-col :span="6">
      <div class="grid-content">span: 6</div>
    </el-col>
    <el-col :span="12">
      <div class="grid-content">span: 12</div>
    </el-col>
  </el-row>

  <!-- 响应式布局 -->
  <el-row :gutter="20">
    <el-col :xs="24" :sm="12" :md="8" :lg="6" :xl="4">
      <div class="grid-content">响应式</div>
    </el-col>
  </el-row>

  <!-- Container布局 -->
  <el-container>
    <el-header>Header</el-header>
    <el-container>
      <el-aside width="200px">Aside</el-aside>
      <el-main>Main</el-main>
    </el-container>
    <el-footer>Footer</el-footer>
  </el-container>
</template>
```

### 6. 上传组件

```vue
<template>
  <el-upload
    action="/api/upload"
    :headers="{ Authorization: token }"
    :data="{ type: 'image' }"
    :before-upload="beforeUpload"
    :on-success="handleSuccess"
    :on-error="handleError"
    :file-list="fileList"
    list-type="picture-card"
    :limit="3"
    :on-exceed="handleExceed"
  >
    <el-icon><Plus /></el-icon>
    <template #tip>
      <div class="el-upload__tip">
        jpg/png文件，大小不超过500KB
      </div>
    </template>
  </el-upload>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const token = ref('your-token')
const fileList = ref([])

const beforeUpload = (file) => {
  const isJPG = file.type === 'image/jpeg' || file.type === 'image/png'
  const isLt500K = file.size / 1024 < 500

  if (!isJPG) {
    ElMessage.error('只能上传 JPG/PNG 格式的图片')
  }
  if (!isLt500K) {
    ElMessage.error('图片大小不能超过 500KB')
  }
  return isJPG && isLt500K
}

const handleSuccess = (response, file) => {
  ElMessage.success('上传成功')
  console.log(response, file)
}

const handleError = (error) => {
  ElMessage.error('上传失败: ' + error.message)
}

const handleExceed = () => {
  ElMessage.warning('最多只能上传3个文件')
}
</script>
```

## 最佳实践

- [ ] 按需引入减少打包体积
- [ ] 使用unplugin插件自动导入
- [ ] 统一配置语言和尺寸
- [ ] 表单验证使用rules
- [ ] 表格分页使用Pagination
- [ ] 异步操作显示Loading
- [ ] 危险操作使用MessageBox确认
- [ ] 合理使用布局组件
- [ ] 主题定制使用CSS变量
- [ ] 图标使用@element-plus/icons-vue

## 常见问题

**Q: 如何自定义主题？**
A: 使用CSS变量或安装element-plus-theme-chalk并修改SCSS变量。

**Q: 表单验证不生效？**
A: 检查form-item的prop是否正确，rules是否配置，ref是否绑定。

**Q: 如何全局配置？**
A: app.use(ElementPlus, { locale, size, zIndex })。

遵循这些实践，高效使用Element Plus构建界面。
