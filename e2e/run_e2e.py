# 実ブラウザE2E: e2e/fixtures を omni-fixture.test:8799 で配信（python3 -m http.server 8799）し、
# /tmp/omni-e2e/fttf-*.json を用意してから uv run --no-project --with playwright==1.63.0 python e2e/run_e2e.py
import asyncio, sys, json, time, os
from playwright.async_api import async_playwright
EXT = os.path.expanduser('~/workspace/omni-search/.output/chrome-mv3')
OUT = '/tmp/omni-e2e/shots'; os.makedirs(OUT, exist_ok=True)
BASE = 'http://omni-fixture.test:8799'
FT = "async (req) => await chrome.runtime.sendMessage(req)"
log = lambda *a: print(*a, flush=True)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/omni-e2e/profile', headless=True, channel='chromium',
            viewport={'width':1280,'height':800}, device_scale_factor=1,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--log-net-log=/tmp/omni-e2e/netlog.json', '--net-log-capture-mode=Default', '--host-resolver-rules=MAP omni-fixture.test 127.0.0.1'])
        errors = []
        ctx.on('weberror', lambda e: errors.append(str(e.error)))
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        opt = await ctx.new_page(); await opt.goto(f'chrome-extension://{ext_id}/options.html')
        opt.on('console', lambda m: m.type == 'error' and errors.append('options: ' + m.text))
        ft = lambda req: opt.evaluate(FT, req)

        # 1. 閲覧して保存
        pages = {}
        for name in ['article', 'english', 'spa']:
            pg = await ctx.new_page(); pg.on('console', lambda m, n=name: m.type == 'error' and errors.append(f'{n}: {m.text}'))
            await pg.goto(f'{BASE}/{name}.html'); pages[name] = pg
        t0 = time.time()
        while time.time() - t0 < 40:
            st = await ft({'action': 'FT_STATS'})
            if st and st['pages'] >= 4: break
            await asyncio.sleep(1)
        log('STATS after browse', st, f'{time.time()-t0:.1f}s')

        # 2. 検索の正しさ
        cases = [('東京都庁', 'article'), ('とうきょうと', None), ('サーバ', 'article'), ('サーバー', 'article'), ('googlechrome', 'article'),
                 ('Google Chrome', 'article'), ('高橋', 'article'), ('全文検索', 'article'), ('量子 暗号', 'article'), ('量子もつれ暗合', 'article'),
                 ('purple elephant', 'english'), ('ペンギン観測所', 'spa'), ('量子 -髙橋', None), ('ＰＵＲＰＬＥ', 'english')]
        ok = True
        for q, expect in cases:
            r = await ft({'action': 'FT_SEARCH', 'query': q, 'limit': 10})
            urls = [h['url'] for h in r['hits']]
            got = urls[0].split('/')[-1].split('.')[0] if urls else None
            if expect == 'spa': got = 'spa' if any('/spa' in u for u in urls) else got
            passed = (got == expect) if expect else (not urls)
            ok &= passed
            sn = r['hits'][0]['snippet'] if r['hits'] else None
            log(f"{'OK ' if passed else 'NG '} {q!r:22} -> {urls[:2]} fuzzy={[h['fuzzy'] for h in r['hits']][:2]} {r['tookMs']:.1f}ms snip={sn and sn['match']!r}")
        log('SEARCH CASES', 'ALL PASS' if ok else 'SOME FAIL')

        # 3. ランチャーUI: englishタブで全文モード検索→Enterでarticleへ飛びフォーカス
        pg = pages['english']; await pg.bring_to_front()
        await sw.evaluate("async () => { const [t] = await chrome.tabs.query({url:'*://omni-fixture.test/english.html'}); await chrome.tabs.sendMessage(t.id,{action:'TOGGLE_SEARCH'}); }")
        inp = pg.locator('omni-search-root input').first
        await inp.wait_for(timeout=5000)
        await inp.type('f 髙橋さんの提案', delay=30)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{OUT}/1-fulltext-mode.png')
        await inp.press('Alt+Enter'); await pg.wait_for_timeout(700)
        await pg.screenshot(path=f'{OUT}/2-preview.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        async with pg.expect_navigation():
            await inp.press('Enter')
        await pg.wait_for_timeout(3500)
        res = await pg.evaluate("""() => ({url: location.pathname, sel: getSelection().toString(), y: Math.round(scrollY),
            hl: !!(window.CSS && CSS.highlights && CSS.highlights.has('omnisearch-ft')),
            inView: (() => { const r = getSelection().rangeCount && getSelection().getRangeAt(0).getBoundingClientRect(); return r ? Math.round(r.top) : null })()})""")
        log('FOCUS', res)
        await pg.screenshot(path=f'{OUT}/3-focused.png')

        # 4. 通常検索に混ざる
        await sw.evaluate("async () => { const [t] = await chrome.tabs.query({url:'*://omni-fixture.test/article.html'}); await chrome.tabs.sendMessage(t.id,{action:'TOGGLE_SEARCH'}); }")
        art = pages['article']; await art.bring_to_front()
        inp2 = art.locator('omni-search-root input').first; await inp2.wait_for(timeout=5000)
        await inp2.type('ペンギン観測所', delay=30); await art.wait_for_timeout(900)
        await art.screenshot(path=f'{OUT}/4-default-mixed.png')
        await inp2.press('Escape')

        # 5. 設定画面とFTTF取り込み
        await opt.bring_to_front()
        await opt.get_by_text('全文検索', exact=True).first.click(); await opt.wait_for_timeout(800)
        await opt.screenshot(path=f'{OUT}/5-options.png', full_page=True)
        for f in ['fttf-small.json', 'fttf-synth.json']:
            t1 = time.time()
            await opt.locator('input[type=file]').set_input_files(f'/tmp/omni-e2e/{f}')
            while time.time() - t1 < 600:
                s = await ft({'action': 'FT_IMPORT_STATUS'})
                if not s['running'] and (s['done'] or s.get('error')): break
                await asyncio.sleep(1)
            log('IMPORT', f, s, f'{time.time()-t1:.1f}s')
        await opt.wait_for_timeout(1500)
        await opt.screenshot(path=f'{OUT}/6-options-after-import.png', full_page=True)
        log('STATS after import', await ft({'action': 'FT_STATS'}))
        for q in ['灯籠流し', '朧月夜の灯台守', 'FTTF']:
            r = await ft({'action': 'FT_SEARCH', 'query': q, 'limit': 5}); log('IMPORTED SEARCH', q, [h['url'] for h in r['hits']][:3], f"{r['tookMs']:.1f}ms")

        # 6. 実ブラウザでの検索速度（content script からの往復）
        lat = await art.evaluate("""async () => { const qs=['東京','会議 報告','サーバー 速度','検索','朧月夜','日本語 データ 分析','合成ページ 4321','かいぎ'];
          const out=[]; for (let k=0;k<5;k++) for (const q of qs){ const t=performance.now(); await new Promise(r=>setTimeout(r,0)); out.push(0); }
          return out.length }""")
        times = []
        for k in range(4):
            for q in ['東京', '会議 報告', 'サーバー 速度', '検索', '朧月夜', '日本語 データ 分析', 'かいぎ', '確認']:
                t = time.perf_counter(); r = await ft({'action': 'FT_SEARCH', 'query': q, 'limit': 20}); el = (time.perf_counter()-t)*1000
                if k: times.append((el, r['tookMs'], q))
        times.sort()
        log('LATENCY roundtrip p50/p95/max ms', round(times[len(times)//2][0],1), round(times[int(len(times)*.95)][0],1), round(times[-1][0],1), 'worker p95', round(sorted(t[1] for t in times)[int(len(times)*.95)],1))

        # 7. SW 再起動後も保存が残るか（永続化）
        await ctx.close()
        ctx = await p.chromium.launch_persistent_context('/tmp/omni-e2e/profile', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--host-resolver-rules=MAP omni-fixture.test 127.0.0.1'])
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        opt = await ctx.new_page(); await opt.goto(f'chrome-extension://{ext_id}/options.html')
        log('STATS after restart', await opt.evaluate(FT, {'action': 'FT_STATS'}))
        log('ERRORS', errors[:20])
        await ctx.close()
asyncio.run(main())
