import { ref } from 'vue'
import type { NoteListItemVO } from '@/api/types'

/**
 * 封面真实宽高比。
 *
 * <p>瀑布流卡片的封面高度按图片**真实**宽高比走（`aspect-ratio: var(--r, 3/4)`），
 * 而不是一律裁成 3/4 或方块 —— 否则横图会被压扁、竖图会留白。
 *
 * <p>VO 里没有图片尺寸，加载前也不知道，所以：未加载时先用 3/4 占位（避免 CLS），
 * `@load` 拿到 naturalWidth/naturalHeight 后改写成真实比例。
 *
 * <p>⚠️ **刻意不给 `<img>` 写 width/height 属性**：真实比例只有解码后才知道，
 * 写死的值必然是错的（详情页封面同理，见 AGENTS.md）。
 *
 * <p><b>为什么抽成 composable</b>（P39）：这段逻辑在
 * HomeView / CollectionsView / TopicView 里各抄了一份，
 * 而 P39 又要在 ProfileView / UserView 里用上 —— 五份副本迟早有一份被漏改，
 * 而症状是「某个列表的卡片高度和别处不一样」，极难归因。
 * 与其抄第五份，不如把这一处收成唯一来源。
 */
export function useCoverRatio() {
  const coverRatio = ref<Record<string, string>>({})

  function onCoverLoad(item: Pick<NoteListItemVO, 'id' | 'cover'>, ev: Event) {
    // ⚠️ P21：无封面（cover 为 null）时**不要**把图片的真实宽高比写进 --r。
    // 兜底图是吉祥物（方图），写进去会让这张卡的高度与其它 3/4 卡不一致 ——
    // 2026-10-08 手测的「关注搭子的笔记大小和其他不符」就是这个。
    // 真正的问题是「这篇笔记没有封面」，不是「吉祥物不是 3/4」：
    // 让这类卡保持 3/4，视觉上它就是一张普通卡，而不是一个比例异常的卡。
    if (!item.cover) return
    const img = ev.target as HTMLImageElement
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h || coverRatio.value[item.id]) return
    coverRatio.value = { ...coverRatio.value, [item.id]: `${w} / ${h}` }
  }

  return { coverRatio, onCoverLoad }
}
