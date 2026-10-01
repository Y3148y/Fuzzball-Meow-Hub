<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'

const { isDark, toggle } = useTheme()
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
    :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
    @click="toggle"
  >
    <van-icon :name="isDark ? 'sun-o' : 'moon-o'" />
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: var(--xk-stroke-w) solid var(--xk-stroke);
  border-radius: 50%;
  background: var(--xk-surface);
  color: var(--xk-text);
  font-size: var(--xk-fs-20);
  cursor: pointer;
  box-shadow: var(--xk-shadow-hard-sm);
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    background-color 0.2s ease,
    color 0.2s ease;
}

.theme-toggle:active {
  transform: translate(3px, 3px);
  box-shadow: 0 0 0 var(--xk-stroke);
}
</style>
