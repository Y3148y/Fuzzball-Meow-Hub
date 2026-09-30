import { del, get, post, postForm, put } from './request'
import type { ImageUploadVO, NotePublishDTO, NoteVO } from './types'

/**
 * 笔记模块接口。
 * 路径对应后端 NoteController 的 @RequestMapping("/api/note")。
 */

/**
 * 上传单张图片。
 *
 * 走 {@link postForm} 而不是普通 post：这里要发 multipart/form-data，
 * Content-Type（含 boundary）必须由浏览器自己填，
 * 手动设置会丢掉 boundary 导致后端解析失败。
 *
 * <p>开了 idempotent：弱网下重传会拿回<b>同一个 URL</b>，而不是多留一个孤儿文件。
 */
export function uploadImage(file: File, onProgress?: (percent: number) => void) {
  const form = new FormData()
  form.append('file', file)

  return postForm<ImageUploadVO>('/note/image', form, {
    // 上传可能比普通请求慢，放宽超时
    timeout: 60000,
    idempotent: true,
    // 上传进度条：axios 只在浏览器 XHR 适配器上支持
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })
}

/**
 * 发布笔记。
 *
 * <b>注意 id 是 string</b>：雪花 ID 10^17 超出 JS 的 MAX_SAFE_INTEGER，
 * 后端 JacksonConfig 把它序列化成字符串，前端不要 Number() 转换。
 *
 * <p>开了 idempotent：用户点完「发布」没等到响应又点一次时，
 * 后端只落一篇，第二次拿回的是同一个 noteId。
 */
export function publishNote(data: NotePublishDTO) {
  return post<NoteVO>('/note/publish', data, { idempotent: true })
}

/**
 * 笔记详情
 */
export function getNoteDetail(id: string) {
  return get<NoteVO>(`/note/${id}`)
}

/**
 * 更新笔记（作者本人，全量覆盖，P10）。
 *
 * <p>编辑走 PUT + 全量字段覆盖语义：不传的字段会被清空（cover/videoUrl 同理），
 * 因此必须把当前表单完整回传。不挂幂等头——编辑不是创建，重复提交无副作用叠加。
 */
export function updateNote(id: string, data: NotePublishDTO) {
  return put<NoteVO>(`/note/${id}`, data)
}

/**
 * 上架 / 下架笔记（作者本人，P10）。
 * status 只接受 1（发布）或 2（下架）；重复设置同一状态幂等。
 */
export function changeNoteStatus(id: string, status: 1 | 2) {
  return put<NoteVO>(`/note/${id}/status`, { status })
}

/**
 * 删除笔记（作者本人，P11）。级联清理图片/点赞/收藏/评论并从搜索移除。
 */
export function deleteNote(id: string) {
  return del<{ success: true }>(`/note/${id}`)
}

/*
 * 下面四个都是「幂等式」的反向操作：重复调用不会出错，只会一直返回最新状态。
 *
 * <b>为什么成功响应是完整的 NoteVO 而不是 void？</b>
 * 因为点赞/收藏本质是「读-改-写」，前端按下按钮后最怕的是
 * 自己本地 +1、而后端因为并发被别人抢先而返回 0，
 * 两者对不上还得再拉一次详情。直接让后端返回权威的最新计数，
 * 前端整体覆盖即可，不用猜。
 */

/** 点赞。返回最新的笔记详情（含 likeCount / collected 等权威计数） */
export function likeNote(id: string) {
  return put<NoteVO>(`/note/${id}/like`)
}

/** 取消点赞 */
export function unlikeNote(id: string) {
  return del<NoteVO>(`/note/${id}/like`)
}

/** 收藏。和点赞是两套独立关系，接口刻意不合并 */
export function collectNote(id: string) {
  return put<NoteVO>(`/note/${id}/collect`)
}

/** 取消收藏 */
export function uncollectNote(id: string) {
  return del<NoteVO>(`/note/${id}/collect`)
}
