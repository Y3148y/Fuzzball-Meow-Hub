<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BizError } from '@/api/request'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'

/**
 * 登录 / 注册。
 *
 * 校验规则和后端 DTO 上的注解一一对应（用户名 4~20、密码 8~20、
 * 用户名只允许字母数字下划线），前端先拦一道是为了少一次往返，
 * 但真正的边界以后端为准 —— 前后端校验规则重复是必要的，不是冗余。
 */
const router = useRouter()
const userStore = useUserStore()

const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const errorMsg = ref('')
/** 同一条提示位既装错误也装成功，颜色要区分开 */
const msgTone = ref<'error' | 'ok'>('error')

const form = reactive({
  username: '',
  password: '',
  nickname: '',
})

/** 演示账号，P2 初始化时种进数据库的，省去手动注册 */
const DEMO = { username: 'xiaoku_demo', password: 'Xk@123456' }

const isRegister = computed(() => mode.value === 'register')

/**
 * 提交按钮只跟着 loading 走，不跟着校验规则走。
 * 一开始写成「填够长度才可点」，结果填错时按钮直接灰掉，用户点了没反应，
 * 也永远看不到「密码长度要在 8~20 之间」到底错在哪 —— 禁用按钮却不给理由是反模式。
 * 现在改成永远可点，点下去由 validate() 给出具体是哪一项不对。
 */
const canSubmit = computed(() => !loading.value)

function switchMode(next: 'login' | 'register') {
  mode.value = next
  errorMsg.value = ''
  msgTone.value = 'error'
}

function fillDemo() {
  mode.value = 'login'
  form.username = DEMO.username
  form.password = DEMO.password
  errorMsg.value = ''
}

function validate(): string {
  const username = form.username.trim()
  if (username.length < 4 || username.length > 20) return '用户名长度要在 4~20 之间'
  if (isRegister.value && !/^[a-zA-Z0-9_]+$/.test(username)) {
    return '用户名只能包含字母、数字和下划线'
  }
  if (form.password.length < 8 || form.password.length > 20) return '密码长度要在 8~20 之间'
  return ''
}

async function submit() {
  if (loading.value) return

  const invalid = validate()
  if (invalid) {
    errorMsg.value = invalid
    msgTone.value = 'error'
    return
  }

  loading.value = true
  errorMsg.value = ''
  try {
    if (isRegister.value) {
      await userStore.register({
        username: form.username.trim(),
        password: form.password,
        nickname: form.nickname.trim() || undefined,
      })
      // 后端注册成功不自动登录，这里切回登录页并把用户名带过去，省得再输一遍
      mode.value = 'login'
      form.password = ''
      errorMsg.value = '注册成功，用这个账号登录吧'
      msgTone.value = 'ok'
      return
    }

    await userStore.login({ username: form.username.trim(), password: form.password })
    await router.replace('/')
  } catch (e) {
    // 静默提交：不弹全局 toast，错误直接显示在表单里
    errorMsg.value = e instanceof BizError ? e.message : '网络异常，稍后再试'
    msgTone.value = 'error'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login">
    <header class="top">
      <span class="brand">毛球喵社</span>
      <ThemeToggle />
    </header>

    <section class="intro">
      <img class="mascot" src="/mascot/m05.webp" alt="小哭猫" />
      <h1 class="title">毛球喵社</h1>
      <p class="tagline">记下来，就不算白忙</p>
    </section>

    <section class="card xk-card">
      <div class="tabs" role="tablist">
        <button
          class="tab"
          :class="{ 'tab--on': !isRegister }"
          type="button"
          role="tab"
          :aria-selected="!isRegister"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          class="tab"
          :class="{ 'tab--on': isRegister }"
          type="button"
          role="tab"
          :aria-selected="isRegister"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="form" novalidate @submit.prevent="submit">
        <label class="field">
          <span class="label">用户名</span>
          <input
            v-model="form.username"
            class="xk-input"
            type="text"
            autocomplete="username"
            placeholder="4~20 位字母 / 数字 / 下划线"
            :disabled="loading"
          />
        </label>

        <label v-if="isRegister" class="field">
          <span class="label">昵称<em>选填</em></span>
          <input
            v-model="form.nickname"
            class="xk-input"
            type="text"
            placeholder="不填就用用户名"
            :disabled="loading"
          />
        </label>

        <label class="field">
          <span class="label">密码</span>
          <input
            v-model="form.password"
            class="xk-input"
            type="password"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            placeholder="8~20 位"
            :disabled="loading"
          />
        </label>

        <p v-if="errorMsg" class="error" :class="{ 'error--ok': msgTone === 'ok' }" role="alert">
          {{ errorMsg }}
        </p>

        <button class="xk-btn" type="submit" :disabled="!canSubmit">
          <van-loading v-if="loading" size="18" color="#1a1e35" />
          <span>{{ isRegister ? '注册' : '登录' }}</span>
        </button>
      </form>

      <button class="demo" type="button" @click="fillDemo">
        用演示账号 <code>{{ DEMO.username }}</code> / <code>{{ DEMO.password }}</code> 填充
      </button>
    </section>

    <p class="foot">P2 用户模块 · JWT 双令牌鉴权</p>
  </main>
</template>

<style scoped>
.login {
  min-height: 100%;
  padding: calc(16px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/*
 * 桌面端：左品牌区（吉祥物 + 标语）+ 右 420 表单。
 * 之前是「420px 居中窄条」，上面压着吉祥物，下面挤着表单 —— 桌面首屏
 * 一半是空的，看着像没做完。两栏后左右各自填满，这才是登录页该有的样子。
 */
@media (min-width: 1024px) {
  .login {
    max-width: 1000px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    grid-template-areas:
      'top   top'
      'intro form';
    column-gap: 56px;
    row-gap: 28px;
    align-items: start;
    padding-top: 64px;
  }

  .top {
    grid-area: top;
  }

  /* 左栏：正文左对齐 + 吉祥物放大，跟右边表单平起平坐 */
  .intro {
    grid-area: intro;
    text-align: left;
    align-self: center;
    padding-left: 8px;
  }

  .intro .mascot {
    width: 240px;
    max-width: 46%;
  }

  .card {
    grid-area: form;
    align-self: center;
  }
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--xk-text-2);
}

.intro {
  text-align: center;
}

.mascot {
  width: 168px;
  max-width: 52%;
  height: auto;
  /* 参考图里小猫是「浮在深蓝底上」的，投影按同样感觉给一层 */
  filter: drop-shadow(0 10px 16px rgba(20, 23, 43, 0.22));
  animation: bob 3.6s ease-in-out infinite;
}

@keyframes bob {
  0%,
  100% {
    transform: translateY(0) rotate(-1.5deg);
  }
  50% {
    transform: translateY(-8px) rotate(1.5deg);
  }
}

.title {
  margin: 4px 0 0;
  font-size: 28px;
  letter-spacing: 0.02em;
}

.tagline {
  margin: 6px 0 0;
  color: var(--xk-text-2);
  font-size: 14px;
}

.card {
  padding: 18px;
}

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}

.tab {
  padding: 10px 0;
  border: var(--xk-stroke-w) solid transparent;
  border-radius: var(--xk-radius-blob-sm);
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.tab--on {
  background: var(--xk-cat);
  border-color: var(--xk-stroke);
  color: #1a1e35;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--xk-text-2);
  padding-left: 4px;
}

.label em {
  margin-left: 6px;
  font-style: normal;
  font-weight: 400;
  color: var(--xk-text-3);
}

.error {
  margin: 0;
  padding: 10px 12px;
  border: var(--xk-stroke-w) solid var(--xk-danger);
  border-radius: var(--xk-radius-blob-sm);
  background: color-mix(in srgb, var(--xk-danger) 12%, transparent);
  color: var(--xk-danger);
  font-size: 13px;
  line-height: 1.5;
}

/* 「注册成功」走同一个提示位，但换成成功色，别让好消息顶着一张红脸 */
.error--ok {
  border-color: var(--xk-success);
  background: color-mix(in srgb, var(--xk-success) 12%, transparent);
  color: var(--xk-success);
}

.demo {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 0;
  border: none;
  background: none;
  color: var(--xk-text-3);
  font-size: 12px;
  text-align: center;
  cursor: pointer;
}

.demo:hover {
  color: var(--xk-text-2);
}

.demo code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: 12px;
}

.foot {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: 12px;
  letter-spacing: 0.06em;
}
</style>
