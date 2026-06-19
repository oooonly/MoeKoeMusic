import { get } from '../../../utils/request';

export default function useCloudMusicQueue(t, musicQueueStore, currentSong, timeoutId) {
    // 娣诲姞浜戠洏姝屾洸鍒版挱鏀惧垪琛?    const addCloudMusicToQueue = async (hash, name, author, timeLength, cover, isReset = true) => {
        const currentSongHash = currentSong.value.hash;
        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('set-tray-title', name + ' - ' + author);
        }

        try {
            clearTimeout(timeoutId.value);
            currentSong.value.author = author;
            currentSong.value.name = name;
            currentSong.value.hash = hash;
            currentSong.value.img = cover;
            currentSong.value.qualityLabel = '';
            currentSong.value.qualityOptions = [];

            console.log('[SongQueue] 鑾峰彇浜戠洏姝屾洸:', hash, name);

            const response = await get('/user/cloud/url', { hash });
            if (response.status !== 1) {
                console.error('[SongQueue] 鑾峰彇浜戠洏闊充箰URL澶辫触:', response);
                currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-shi-bai');
                if (musicQueueStore.queue.length === 0) return { error: true };
                currentSong.value.author = t('3-miao-hou-zi-dong-qie-huan-xia-yi-shou');

                // 杩斿洖闇€瑕佸垏鎹㈠埌涓嬩竴棣栫殑鏍囧織锛岃€屼笉鏄洿鎺ヨ皟鐢╬laySongFromQueue
                return { error: true, shouldPlayNext: true };
            }

            // 璁剧疆URL
            if (response.data && response.data.url) {
                currentSong.value.url = response.data.url;
                console.log('[SongQueue] 鑾峰彇鍒颁簯鐩橀煶涔怳RL:', currentSong.value.url);
            } else {
                console.error('[SongQueue] 鏈幏鍙栧埌浜戠洏闊充箰URL');
                currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-shi-bai');
                return { error: true };
            }

            // 鍒涘缓姝屾洸瀵硅薄
            const song = {
                id: musicQueueStore.queue.length + 1,
                hash: hash,
                name: name,
                author: author,
                img: cover,
                timeLength: timeLength || 0,
                url: response.data.url,
                isCloud: true
            };

            // 鏍规嵁鏄惁闇€瑕侀噸缃挱鏀句綅缃?            if (isReset) {
                localStorage.setItem('player_progress', 0);
            }

            // 鏇存柊闃熷垪
            const existingSongIndex = musicQueueStore.queue.findIndex(song => song.hash === hash);
            if (existingSongIndex === -1) {
                const currentIndex = musicQueueStore.queue.findIndex(song => song.hash == currentSongHash);
                if (currentIndex !== -1) {
                    musicQueueStore.queue.splice(currentIndex + 1, 0, song);
                } else {
                    musicQueueStore.addSong(song);
                }
            } else {
                // 濡傛灉姝屾洸宸插瓨鍦紝鍙洿鏂板綋鍓嶆瓕鏇茬殑淇℃伅锛屼笉淇敼闃熷垪
                currentSong.value = song;
            }

            // 杩斿洖姝屾洸瀵硅薄
            return { song };
        } catch (error) {
            console.error('[SongQueue] 鑾峰彇浜戠洏闊充箰鍦板潃鍑洪敊:', error);
            currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-di-zhi-shi-bai');
            if (musicQueueStore.queue.length === 0) return { error: true };
            currentSong.value.author = t('3-miao-hou-zi-dong-qie-huan-xia-yi-shou');

            // 杩斿洖闇€瑕佸垏鎹㈠埌涓嬩竴棣栫殑鏍囧織锛岃€屼笉鏄洿鎺ヨ皟鐢╬laySongFromQueue
            return { error: true, shouldPlayNext: true };
        }
    };

    // 鎵归噺娣诲姞浜戠洏姝屾洸鍒版挱鏀惧垪琛?    const addCloudPlaylistToQueue = async (songs, append = false) => {
        let queueSongs = [];
        if (!append) {
            musicQueueStore.clearQueue();
        } else {
            queueSongs = [...musicQueueStore.queue];
        }

        const addedHashes = new Set(queueSongs.map(song => song.hash));
        const newSongs = songs.reduce((list, song) => {
            if (!song.hash || addedHashes.has(song.hash)) return list;
            addedHashes.add(song.hash);
            list.push({
                id: queueSongs.length + list.length + 1,
                hash: song.hash,
                name: song.name,
                author: song.author,
                timeLength: song.timelen || 0,
                url: song.url,
                isCloud: true
            });
            return list;
        }, []);

        if (append) {
            queueSongs = [...queueSongs, ...newSongs];
        } else {
            queueSongs = newSongs;
        }

        musicQueueStore.queue = queueSongs;
        return queueSongs;
    };

    return {
        addCloudMusicToQueue,
        addCloudPlaylistToQueue
    };
}
