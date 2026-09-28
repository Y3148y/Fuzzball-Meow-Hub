import type { AxiosRequestConfig } from 'axios'
import http, { get, post } from './request'
import type { ImageUploadVO, NotePublishDTO, NoteVO } from './types'

/**
 * 笔记模块接口。
 * 路径对应后端 NoteController 的 @RequestMapping("/api/note")。
 */

/**
 * 上传单张图片。
 *
 * <b>刻意不走 request.ts 里那三个 get/post 包装</b>：那三个都按 JSON 传 body，
 * 而这里是 multipart/form-data，必须让浏览器自己填 Content-Type（含 boundary），
 * 手动设置会丢掉 boundary 导致后端解析失败。
 */
export function uploadImage(file: File, onProgress?: (percent: number) => void) {
  const form = new FormData()
  form.append('file', file)

  return http.post<ImageUploadVO>('/note/image', form, {
    // 上传可能比普通请求慢，放宽超时
    timeout: 60000,
    // 上传进度条：axios 只在浏览器 XHR 适配器上支持
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  } as AxiosRequestConfig) as unknown as Promise<ImageUploadVO>
}

/**
 * 发布笔记。
 *
 * <b>注意 id 是 string</b>：雪花 ID 10^17 超出 JS 的 MAX_SAFE_INTEGER，
 * 后端 JacksonConfig 把它序列化成字符串，前端不要 Number() 转换。
 */
export function publishNote(data: NotePublishDTO) {
  return post<NoteVO>('/note/publish', data)
}

/** 笔记详情 */
export function getNoteDetail(id: string) {
  return get<NoteVO>(`/note/${id}`)
}
