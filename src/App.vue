<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import SongsView from '@/views/SongsView.vue'
import FoldersView from '@/views/FoldersView.vue'
import AlbumsView from '@/views/AlbumsView.vue'
import AlbumDetailView from '@/views/AlbumDetailView.vue'
import ArtistDetailView from '@/views/ArtistDetailView.vue'
import ArtistsView from '@/views/ArtistsView.vue'
import GenresView from '@/views/GenresView.vue'
import PlaylistsView from '@/views/PlaylistsView.vue'
import LyricsFullView from '@/views/LyricsFullView.vue'
import SettingsView from '@/views/SettingsView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useSettingsStore } from '@/stores/settings'
import { clearTransitionState } from '@/services/pageTransition'
import type { ViewId } from '@/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const settings = useSettingsStore()

const viewTitles: Record<ViewId, string> = {
  songs: '歌曲',
  genres: '曲风',
  albums: '专辑',
  artists: '艺术家',
  folders: '文件夹',
  playlists: '歌单',
  settings: '设置',
}

const title = computed(() => viewTitles[ui.activeView])
const selectedRootId = ref<string | null>(null)
const sectionEl = ref<HTMLElement | null>(null)

/* ---------- 全应用滚动位置记忆 ----------
   切视图 / 钻取详情前把旧容器的 scrollTop 记入 ui store，
   回来时（Transition enter 或同视图钻取返回）恢复。
   key：`view:<视图>|<detailKey>`；SongList/VirtualList 的内部滚动由组件自己记（list:*）。 */
const scrollKey = (view: string, detail: string | null) => `view:${view}|${detail ?? ''}`
const INLINE_DETAIL_VIEWS = new Set<string>(['genres', 'playlists'])

watch(
  [() => ui.activeView, () => ui.detailKey] as const,
  ([view, detail], [oldView, oldDetail]) => {
    // pre-flush：此刻 DOM 还是旧视图的，正好捕获它的滚动位置
    if (sectionEl.value) {
      ui.rememberScroll(scrollKey(oldView, oldDetail), sectionEl.value.scrollTop)
    }
    // 同视图内钻取/返回（详情内联在视图里，DOM 会重建）：更新后恢复目标状态的位置。
    // 专辑详情是覆盖层、网格 DOM 不重建，绝不能在这里动它的 scrollTop。
    if (view === oldView && detail !== oldDetail && INLINE_DETAIL_VIEWS.has(view)) {
      nextTick(() => {
        if (sectionEl.value) sectionEl.value.scrollTop = ui.recallScroll(scrollKey(view, detail))
      })
    }
  },
)

function onViewEnter(el: Element) {
  ;(el as HTMLElement).scrollTop = ui.recallScroll(scrollKey(ui.activeView, ui.detailKey))
}

function addFolder() {
  library.addFolder()
}

onMounted(async () => {
  settings // 触发主题初始化
  playlistStore.load()
  await library.init()
  await player.restore()
})

/** 切换视图时清理过渡残留（网格可能已被卸载，动画引用会指向已销毁的 DOM） */
watch(
  () => ui.activeView,
  () => clearTransitionState(),
)

/** 详情覆盖层被绕过返回过渡直接关闭时（典型：详情打开时点侧边栏当前视图，
    navigate 只改 detailKey、activeView 不变，上面那个 watcher 不会触发），
    必须强制清理 —— 否则网格卡片停留在坍缩终态（opacity:0），表现为大面积空白。 */
watch(
  () => ui.detailKey,
  (detail, old) => {
    if (detail === null && old !== null) clearTransitionState()
  },
)
</script>

<template>
  <div class="app-shell">
    <div class="body-row">
      <Sidebar />
      <main class="content">
        <header class="view-header">
          <h1>{{ title }}</h1>
        </header>
        <Transition name="view" mode="out-in" @enter="onViewEnter">
          <section ref="sectionEl" :key="ui.activeView" class="view-body">
            <!-- 注意：这条 v-if / v-else-if 链必须从 SongsView 一路连通到 PlaceholderView。
                 曾经 template v-if 与 SongsView 的 v-if 断开成两条链，
                 songs 视图下兜底的 PlaceholderView 也会渲染，view-body 被撑出
                 双倍高度 → 外层滚动条出现 + 内层虚拟列表失效。 -->
            <SongsView v-if="ui.activeView === 'songs'" @add-folder="addFolder" />

            <AlbumsView v-else-if="ui.activeView === 'albums'" />

            <ArtistsView v-else-if="ui.activeView === 'artists'" />
            <GenresView v-else-if="ui.activeView === 'genres'" />

            <FoldersView v-else-if="ui.activeView === 'folders'" v-model:selected-root="selectedRootId" @add-folder="addFolder" />

            <PlaylistsView v-else-if="ui.activeView === 'playlists'" />

            <SettingsView v-else-if="ui.activeView === 'settings'" @add-folder="addFolder" />

            <PlaceholderView v-else :key="ui.activeView" :title="title" />
          </section>
        </Transition>

        <!-- 专辑详情：不放在上面的 Transition 里。
             详情与网格是同 activeView 内的 detailKey 切换，:key 不变 → 外层 Transition 不会触发；
             而 v-if/v-else 会让网格立刻卸载，网格就没法参与"相机后退"。
             移到 .content 内的绝对定位覆盖层后，网格始终挂载，滚动位置与卡片 DOM 全部保留。 -->
        <AlbumDetailView
          v-if="ui.activeView === 'albums' && ui.detailKey"
          :album-key="ui.detailKey"
          class="detail-layer"
        />
        <!-- 艺术家详情：与专辑详情同架构（覆盖层 + 引力坍缩过渡） -->
        <ArtistDetailView
          v-else-if="ui.activeView === 'artists' && ui.detailKey"
          :artist-name="ui.detailKey"
          class="detail-layer"
        />
      </main>
    </div>
    <PlayerBar />
    <LyricsFullView v-if="ui.lyricsOpen" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.body-row {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 专辑详情覆盖层：盖住标题与网格，自带滚动；放在 .content 内天然避开侧栏与播放条 */
.detail-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px 24px;
  background: var(--bg-base);
}

.view-header {
  padding: 20px 24px 12px;
}

.view-header h1 {
  font-size: 22px;
  font-weight: 600;
}

.view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 24px 24px;
}
</style>
