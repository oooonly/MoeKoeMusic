import { get } from '../../../utils/request';
import { MoeAuthStore } from '../../../stores/store';

const QUALITY_LEVELS = ['128', '320', 'flac', 'high', 'viper_atmos', 'viper_clear', 'viper_tape'];
const QUALITY_LABELS = {
    '128': '鏍囧噯',
    '320': '楂樺搧',
    flac: 'FLAC',
    high: 'Hi-Res',
    viper_atmos: '鍏ㄦ櫙澹?,
    viper_clear: '瓒呮竻',
    viper_tape: '姣嶅甫'
};

const normalizeQuality = (quality) => {
    return QUALITY_LEVELS.includes(quality) ? quality : '128';
};

const getFallbackChain = (quality) => QUALITY_LEVELS.slice(0, QUALITY_LEVELS.indexOf(normalizeQuality(quality)) + 1).reverse();

const getQualityLabel = (quality) => QUALITY_LABELS[quality] || '';

const getPrivilegeVariants = (response) => {
    const variants = [];

    for (const item of response?.data || []) {
        for (const variant of [item, ...(item?.relate_goods || [])]) {
            if (!variant?.hash || variant?.level === 0 || !QUALITY_LEVELS.includes(variant?.quality)) continue;
            variants.push(variant);
        }
    }

    return variants;
};

const getQualityOptions = (response) => {
    const qualityOptions = new Map();

    for (const variant of getPrivilegeVariants(response)) {
        if (qualityOptions.has(variant.quality)) continue;
        qualityOptions.set(variant.quality, {
            value: variant.quality,
            hash: variant.hash,
            label: getQualityLabel(variant.quality)
        });
    }

    return [...qualityOptions.values()].sort((a, b) => QUALITY_LEVELS.indexOf(b.value) - QUALITY_LEVELS.indexOf(a.value));
};

const getPrivilegeCandidates = (qualityOptions, quality, originalHash) => {
    const candidatesByQuality = new Map();

    for (const option of qualityOptions) {
        if (!candidatesByQuality.has(option.value)) {
            candidatesByQuality.set(option.value, {
                hash: option.hash,
                quality: option.value
            });
        }
    }

    const fallbackChain = getFallbackChain(quality);
    const candidates = fallbackChain.map(itemQuality => candidatesByQuality.get(itemQuality)).filter(Boolean);

    return candidates.length > 0 ? candidates : fallbackChain.map(itemQuality => ({
        hash: originalHash,
        quality: itemQuality
    }));
};

export default function useOnlineMusicQueue(t, musicQueueStore, currentSong, timeoutId) {
    let activeSongRequestId = 0;

    // 娣诲姞姝屾洸鍒伴槦鍒楀苟鎾斁
    const addSongToQueue = async (hash, name, img, author, isReset = true, qualityOverride = '', cachedQualityOptions = []) => {
        if(!hash) return { error: true };
        const requestId = ++activeSongRequestId;
        const isStaleRequest = () => requestId !== activeSongRequestId;
        const currentSongHash = currentSong.value.hash;
        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('set-tray-title', name + ' - ' + author);
        }

        try {
            clearTimeout(timeoutId.value);
            currentSong.value.author = author;
            currentSong.value.name = name;
            currentSong.value.img = img;
            currentSong.value.hash = hash;
            currentSong.value.playHash = hash;
            currentSong.value.resolvedQuality = '';
            currentSong.value.qualityLabel = '';
            currentSong.value.qualityOptions = [];

            console.log('[SongQueue] 鑾峰彇姝屾洸:', hash, name);

            const settings = JSON.parse(localStorage.getItem('settings') || '{}');
            const data = {
                hash: hash
            };

            // 鏍规嵁鐢ㄦ埛璁剧疆纭畾璇锋眰鍙傛暟
            const MoeAuth = typeof MoeAuthStore === 'function' ? MoeAuthStore() : { isAuthenticated: false };
            const isAuth = !!MoeAuth.isAuthenticated;

            let response = null;
            let selectedCandidate = { hash, quality: '' };
            let qualityOptions = [];

            if (!isAuth) {
                data.free_part = 1;
                response = await get('/song/url', data);
                if (isStaleRequest()) return { stale: true };
            } else {
                const q = normalizeQuality(qualityOverride || settings?.quality);
                const fallbackCandidates = getFallbackChain(q).map(itemQuality => ({
                    hash,
                    quality: itemQuality
                }));
                let candidates = fallbackCandidates;
                qualityOptions = Array.isArray(cachedQualityOptions) ? cachedQualityOptions.map(option => ({ ...option })) : [];

                try {
                    if (qualityOptions.length === 0) {
                        const privilegeResponse = await get(`/privilege/lite`, { hash: hash });
                        if (isStaleRequest()) return { stale: true };
                        qualityOptions = getQualityOptions(privilegeResponse);
                    }
                    candidates = getPrivilegeCandidates(qualityOptions, q, hash);
                } catch (error) {
                    if (error.response?.data?.error?.includes('楠岃瘉')) {
                        throw error;
                    }
                    if (error.response?.data?.status == 2) {
                        throw error;
                    }
                    console.error('[SongQueue] 鑾峰彇姝屾洸璇︽儏澶辫触锛屽洖閫€鍒板師濮嬪搱甯岃姹?', error);
                }

                for (const candidate of candidates) {
                    try {
                        const candidateResponse = await get('/song/url', {
                            hash: candidate.hash,
                            quality: candidate.quality,
                            ppage_id: '356753938'
                        });
                        if (isStaleRequest()) return { stale: true };

                        if (candidateResponse.status !== 1) {
                            response = candidateResponse;
                            continue;
                        }

                        if (candidateResponse.extName == 'mp4') {
                            console.log('[SongQueue] 姝屾洸鏍煎紡涓篗P4锛屽皾璇曡幏鍙栦笅涓€妗ｉ煶璐?);
                            response = candidateResponse;
                            continue;
                        }

                        if (!candidateResponse.url || !candidateResponse.url[0]) {
                            response = candidateResponse;
                            continue;
                        }

                        response = candidateResponse;
                        selectedCandidate = candidate;
                        break;
                    } catch (error) {
                        if (error.response?.data?.error?.includes('楠岃瘉')) {
                            throw error;
                        }
                        if (error.response?.data?.status == 2) {
                            throw error;
                        }
                        console.error('[SongQueue] 鑾峰彇鍊欓€夐煶璐ㄥけ璐?', error);
                    }
                }
            }

            if (isStaleRequest()) return { stale: true };

            if (!response || response.status !== 1) {
                console.error('[SongQueue] 鑾峰彇闊充箰URL澶辫触:', response);
                currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-shi-bai');
                if (response?.status == 3) {
                    currentSong.value.name = t('gai-ge-qu-zan-wu-ban-quan');
                }
                if (musicQueueStore.queue.length === 0) return { error: true };
                currentSong.value.author = t('3-miao-hou-zi-dong-qie-huan-xia-yi-shou');

                // 杩斿洖闇€瑕佸垏鎹㈠埌涓嬩竴棣栫殑鏍囧織锛岃€屼笉鏄洿鎺ヨ皟鐢╬laySongFromQueue
                return { error: true, shouldPlayNext: true };
            }

            // 璁剧疆URL
            if (response.url && response.url[1]) {
                currentSong.value.url = `${import.meta.env.VITE_APP_API_URL}song/raw?targetUrl=${response.url[1]}`;
                currentSong.value.playHash = selectedCandidate.hash || hash;
                currentSong.value.resolvedQuality = selectedCandidate.quality || '';
                currentSong.value.qualityLabel = getQualityLabel(selectedCandidate.quality);
                currentSong.value.qualityOptions = qualityOptions.map(option => ({ ...option }));
                console.log('[SongQueue] 鑾峰彇鍒伴煶涔怳RL:', currentSong.value.url);
            } else {
                console.error('[SongQueue] 鏈幏鍙栧埌闊充箰URL');
                currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-shi-bai');
                return { error: true };
            }

            // 鍒涘缓姝屾洸瀵硅薄
            const song = {
                id: musicQueueStore.queue.length + 1,
                hash: hash,
                playHash: selectedCandidate.hash || hash,
                resolvedQuality: selectedCandidate.quality || '',
                qualityLabel: getQualityLabel(selectedCandidate.quality),
                qualityOptions: qualityOptions.map(option => ({ ...option })),
                name: name,
                img: img,
                author: author,
                timeLength: response.timeLength,
                url: `${import.meta.env.VITE_APP_API_URL}song/raw?targetUrl=${response.url[1]}`,
                // 鍝嶅害瑙勬牸鍖栧弬鏁?                loudnessNormalization: {
                    volume: response.volume || 0,
                    volumeGain: response.volume_gain || 0,
                    volumePeak: response.volume_peak || 1
                }
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
            if (isStaleRequest()) return { stale: true };
            console.error('[SongQueue] 鑾峰彇闊充箰鍦板潃鍑洪敊:', error);
            currentSong.value.author = currentSong.value.name = t('huo-qu-yin-le-di-zhi-shi-bai');
            if (error.response?.data?.error?.includes('楠岃瘉')) {
                window.$modal.alert('璐︽埛椋庢帶,璇风◢鍊欓噸璇?');
                return { error: true};
            }
            if (error.response?.data?.status == 2) {
                window.$modal.alert(t('deng-lu-shi-xiao-qing-zhong-xin-deng-lu'));
                return { error: true};
            }
            if (musicQueueStore.queue.length === 0) return { error: true };
            currentSong.value.author = t('3-miao-hou-zi-dong-qie-huan-xia-yi-shou');

            // 杩斿洖闇€瑕佸垏鎹㈠埌涓嬩竴棣栫殑鏍囧織锛岃€屼笉鏄洿鎺ヨ皟鐢╬laySongFromQueue
            return { error: true, shouldPlayNext: true };
        }
    };

    // 鑾峰彇姝屽崟鍏ㄩ儴姝屾洸
    const getPlaylistAllSongs = async (id) => {
        try {
            let allSongs = [];
            for (let page = 1; page <= 4; page++) {
                const url = `/playlist/track/all?id=${id}&pagesize=300&page=${page}`;
                const response = await get(url);
                if (response.status !== 1) {
                    window.$modal.alert(t('huo-qu-ge-dan-shi-bai'));
                    return;
                }
                if (Object.keys(response.data.info).length === 0) break;
                allSongs = allSongs.concat(response.data.info);
                if (response.data.info.length < 300) break;
            }
            return allSongs;
        } catch (error) {
            console.error(error);
            window.$modal.alert(t('huo-qu-ge-dan-shi-bai'));
            return null;
        }
    };

    // 娣诲姞姝屽崟鍒版挱鏀惧垪琛?    const addPlaylistToQueue = async (info, append = false) => {
        let songs = [];
        if (!append) {
            musicQueueStore.clearQueue();
        } else {
            songs = [...musicQueueStore.queue];
        }

        const addedHashes = new Set(songs.map(song => song.hash));
        const newSongs = info.reduce((list, song) => {
            if (!song.hash || addedHashes.has(song.hash)) return list;
            addedHashes.add(song.hash);
            list.push({
                id: songs.length + list.length + 1,
                hash: song.hash,
                name: song.name,
                img: song.cover?.replace("{size}", 480) || './assets/images/ico.png',
                author: song.author,
                timeLength: song.timelen
            });
            return list;
        }, []);

        if (append) {
            songs = [...songs, ...newSongs];
        } else {
            songs = newSongs;
        }

        musicQueueStore.queue = songs;
        return songs;
    };

    // 鑾峰彇姝屾洸璇︽儏
    const privilegeSong = async (hash) => {
        const response = await get(`/privilege/lite`,{hash:hash});
        return response;
    };

    return {
        addSongToQueue,
        getPlaylistAllSongs,
        addPlaylistToQueue,
        privilegeSong
    };
}
