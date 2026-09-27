<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { get } from '@/api/request'

interface PingVO {
  applicationName: string
  machineId: number
  snowflakeId: number
  snowflakeParsed: string
  serverTime: string
}

const loading = ref(true)
const ping = ref<PingVO | null>(null)
const errorMsg = ref('')

async function fetchPing() {
  loading.value = true
  errorMsg.value = ''
  try {
    ping.value = await get<PingVO>('/system/ping')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(fetchPing)
</script>

<template>
  <main class="page">
    <header class="hero">
      <h1>小哭猫 Xiaoku</h1>
      <p class="subtitle">P0 环境与工程骨架自检</p>
    </header>

    <van-loading v-if="loading" class="block">正在请求后端…</van-loading>

    <van-notice-bar v-else-if="errorMsg" color="#ee0a24" :text="errorMsg" wrapable />

    <van-cell-group v-else-if="ping" inset>
      <van-cell title="applicationName" :value="ping.applicationName" />
      <van-cell title="machineId" :value="String(ping.machineId)" />
      <van-cell title="snowflakeId" :value="String(ping.snowflakeId)" />
      <van-cell title="雪花ID解析" :value="ping.snowflakeParsed" />
      <van-cell title="serverTime" :value="ping.serverTime" />
    </van-cell-group>

    <van-button class="block" type="primary" block @click="fetchPing">重新请求</van-button>
  </main>
</template>

<style scoped>
.page {
  padding: 24px 16px;
  max-width: 640px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  padding: 32px 0 24px;
}

.hero h1 {
  margin: 0;
  font-size: 26px;
}

.subtitle {
  margin: 8px 0 0;
  color: var(--xk-text-secondary);
  font-size: 14px;
}

.block {
  margin: 16px 0;
}
</style>
