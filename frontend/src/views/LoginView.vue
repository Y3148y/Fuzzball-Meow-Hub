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

/**
 * 演示账号，P2 初始化时种进数据库的，省去手动注册
 *
 * <p>⚠️ **这个账号只在 dev 库里存在**：prod 的 `XK_INIT_DEMO_DATA=false`
 * （演示数据仅在 dev/test profile 生成），而 prod 真实账号是
 * `xk_ui_admin` / `xk_ui_admin2`（口令 `Xk@2026peer`）。
 *
 * <p>所以按钮**只在开发模式显示** —— 之前它无条件渲染，于是 prod 上给用户一个
 * 点了必然报「用户名或密码错误」的入口。手测时就是这个按钮把流程卡住的。
 *
 * <p>⚠️ **凭据必须放在 `if (import.meta.env.DEV)` 里面，不能只是 v-if**：
 * 第一版把常量留在模块顶层、只用 `v-if="showDemo"` 藏按钮，界面确实消失了，
 * 但**口令明文仍留在 prod 的产物里**（实测 `LoginView-*.js` 里能搜到
 * `xiaoku_demo` 与 `Xk@123456`）—— Vite 只对表达式做常量折叠，
 * 不会因为「没人引用」就删掉一个模块顶层的字符串字面量。
 * 而 prod 产物是公开可下载的，等于口令公开。
 */
const showDemo = import.meta.env.DEV
const DEMO = showDemo ? { username: 'xiaoku_demo', password: 'Xk@123456' } : null

/**
 * 生产环境可用的测试账号（prod 库真实存在的那两个 fixture）
 *
 * <p>⚠️ 这两个账号**不是**产品的一部分，是自动化测试用的常驻 fixture
 * （AGENTS 第 5 节：「撞 10003 都判为通过，三个都不要清理」）。
 * 把口令印在登录页上等于把测试账号公开 —— 对一个真实部署的站点不合适，
 * 对本项目（个人作品、要给人看界面）却是必要的，否则没人登得进去。
 * 所以这行**只在生产构建里出现**，且没有文案解释它是什么。
 *
 * <p>**为什么要两个**：私信要能看到「对方」，只有一个账号就没法自测收发两侧
 * （P35 那轮用户正是从接收方视角发现问题）。第一版只列了
 * `xk_ui_admin`，于是手测时得改口令或手工注册第二个，属于半截。
 *
 * <p>⚠️ 口令相同是刻意的：两个 fixture 在 AGENTS 里就是同一个口令，
 * 手测时少一次「记错哪个」的失败点。UI 上把两者都列出来，
 * 点哪一行就填哪一行 —— 用两个按钮而不是一段文字，
 * 因为「点了要发生什么」得是可见的控件，不能靠猜。
 */
const PROD_TEST = showDemo
  ? null
  : [
      { username: 'xk_ui_admin', password: 'Xk@2026peer', label: '管理员' },
      { username: 'xk_ui_admin2', password: 'Xk@2026peer', label: '管理员 2' },
    ]

function fillDemo() {
  if (!DEMO) return
  // 强制切回登录模式：用户可能在「注册」tab 上点这个按钮，
  // 而注册模式下点提交会拿演示账号去注册（必然撞 10003）
  mode.value = 'login'
  form.username = DEMO.username
  form.password = DEMO.password
  errorMsg.value = ''
  msgTone.value = 'error'
}

function fillProdHint(acc: { username: string; password: string }) {
  if (!PROD_TEST) return
  mode.value = 'login'
  form.username = acc.username
  form.password = acc.password
  errorMsg.value = ''
  msgTone.value = 'error'
}

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
      <img class="mascot" src="/mascot/m05.webp" alt="小哭猫" width="168" height="168" />
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
            spellcheck="false"
            placeholder="4~20 位字母 / 数字 / 下划线…"
            :disabled="loading"
          />
        </label>

        <label v-if="isRegister" class="field">
          <span class="label">昵称<em>选填</em></span>
          <input
            v-model="form.nickname"
            class="xk-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="不填就用用户名…"
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
            placeholder="8~20 位…"
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

      <!--
        ⚠️ 只在开发模式显示：这个账号**只存在于 dev 库**
        （prod 的 XK_INIT_DEMO_DATA=false）。无条件渲染等于给 prod 用户一个
        点了必然失败的入口 —— 手测时它把人卡在这一步，
        而报错「用户名或密码错误」与「这个账号根本不存在」之间没有任何提示。
      -->
      <button v-if="showDemo" class="demo" type="button" data-test="demo" @click="fillDemo">
        用演示账号 <code>{{ DEMO?.username }}</code> / <code>{{ DEMO?.password }}</code> 填充
      </button>

      <!--
        prod 上给出真实可用的账号 —— 「没有演示账号」不该表现为「演示账号密码错误」。
        同样只在生产模式显示，避免 dev 用户被这行干扰（dev 有演示账号可用）。

        ⚠️ **逐账号一行、各自可点**，而不是一行文字两个名字 ——
        「点了会发生什么」必须是看得见的控件（点哪行填哪个账号），
        一段并列的名字只能让人自己猜该点哪儿。

        ⚠️ 用 `<button>` 而不是 clickable `<p>`：点一下填表单是**动作**不是导航
        （AGENTS P21 的「导航归 a、动作归 button」），读屏软件只派发 click
        给可聚焦的原生控件，而 `<p>` 没有 role、没有 tab 序、没有键盘可达性。
      -->
      <div v-else class="prod-hints" data-test="prod-hint">
        <button
          v-for="acc in PROD_TEST"
          :key="acc.username"
          type="button"
          class="prod-hint"
          :data-test="'prod-hint-' + acc.username"
          :aria-label="'用测试账号 ' + acc.username + ' 填充表单'"
          @click="fillProdHint(acc)"
        >
          测试账号 <code>{{ acc.username }}</code> / <code>{{ acc.password }}</code>
          <span class="tag">{{ acc.label }}</span>
        </button>
      </div>
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
  font-size: var(--xk-fs-15);
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
  font-size: var(--xk-fs-30);
  letter-spacing: 0.02em;
}

.tagline {
  margin: 6px 0 0;
  color: var(--xk-text-2);
  font-size: var(--xk-fs-14);
}

.card {
  padding: var(--xk-card-pad);
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
  font-size: var(--xk-fs-15);
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
  font-size: var(--xk-fs-13);
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
  font-size: var(--xk-fs-13);
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
  font-size: var(--xk-fs-12);
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
  font-size: var(--xk-fs-12);
}

/*
 * 生产环境的测试账号提示。
 *
 * ⚠️ 不用 .demo 的样式：视觉语言接近，但这里的元素是 <button>，
 * 而 .demo 已经是 button，两者只需要共享 code / tag 的观感。
 */
.prod-hints {
  display: flex;
  flex-direction: column;
  gap: var(--xk-space-2);
  margin-top: var(--xk-space-4);
}

.prod-hint {
  /* button 的默认外观/字体全要复位，否则会带出原生按钮的边框与背景 */
  appearance: none;
  border: 0;
  background: none;
  font: inherit;
  text-align: center;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
  cursor: pointer;
  /* P13 热区下限：只有 12px 的一行字时，热区约 20px，手指点不准 */
  min-height: 40px;
  padding: var(--xk-space-2) 0;
  border-radius: var(--xk-radius-md, 10px);
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s, background-color 0.15s;
}
.prod-hint:hover { color: var(--xk-text-2); background: var(--xk-surface-2); }
.prod-hint code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--xk-surface-2);
  color: var(--xk-text-2);
  font-size: var(--xk-fs-12);
}
.prod-hint:hover code { background: var(--xk-bg-soft); }

/* 账号用途标签：说明「为什么是两个」而不是「这是什么」——
   这是个给人看界面的作品站，测试账号不该被误当成产品功能 */
.tag {
  margin-left: var(--xk-space-2);
  padding: 1px 6px;
  border: 1px solid var(--xk-border);
  border-radius: 999px;
  font-size: var(--xk-fs-12);
  color: var(--xk-text-3);
}

.foot {
  margin: 0;
  text-align: center;
  color: var(--xk-text-3);
  font-size: var(--xk-fs-12);
  letter-spacing: 0.06em;
}
</style>
