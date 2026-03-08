const axios = require('axios').default;
const { HttpsProxyAgent } = require('https-proxy-agent');

// Proxy Sesuai Script Sukses Anda
const PROXY_STRING = 'fa20a3a4965a5860c5b8__cr.us:6e4cd8df17331bf6@gw.dataimpulse.com:823';
const globalAgent = new HttpsProxyAgent(`http://${PROXY_STRING}`);

// Helper XOR (SAMA PERSIS)
function xor(text, key = 5) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key);
    }
    return result;
}

// Fungsi login Capcut (PERSIS SCRIPT SUKSES)
async function loginCapcut(email, password, proxyAgent = globalAgent) {
    const encryptedEmail = Buffer.from(xor(email)).toString('hex');
    const encryptedPassword = Buffer.from(xor(password)).toString('hex');
    
    const options = {
        method: 'POST',
        httpsAgent: proxyAgent,
        url: 'https://login.us.capcut.com/passport/web/email/login/',
        params: {
            aid: '348188',
            account_sdk_source: 'web',
            sdk_version: '2.1.10-tiktok',
            language: 'en',
            verifyFp: 'verify_mk74eyl0_OpfJ6pq6_unaT_4yZv_BFLN_Z28i6CMGhcbr'
        },
        headers: {
            host: 'login.us.capcut.com',
            connection: 'keep-alive',
            appid: '348188',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua': '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'x-tt-passport-csrf-token': '740c4e28ab5b50fbdab171893aa4291a',
            'store-country-code-src': 'uid',
            'store-country-code': 'us',
            did: '7593407321923438094',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            accept: 'application/json, text/javascript',
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://www.capcut.com',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            referer: 'https://www.capcut.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
        },
        data: new URLSearchParams({
            mix_mode: '1',
            email: encryptedEmail,
            password: encryptedPassword,
            fixed_mix_mode: '1'
        })
    };
    
    const { data, headers } = await axios.request(options);
    
    if (data.message === 'success' || data.data?.user_id) {
        const setCookieHeader = headers['set-cookie'] || headers['Set-Cookie'];
        if (!setCookieHeader) throw new Error('Cookie missing.');
        const sessionCookie = setCookieHeader.find(c => c.includes('sessionid='));
        return sessionCookie.split(';')[0];
    } else {
        throw new Error(data?.data?.description || data?.message || 'Login failed');
    }
}

// Fungsi join team (PERSIS SCRIPT SUKSES)
async function joinTeam(inviteLink, sessionCookie, proxyAgent = globalAgent) {
    const options = {
        method: 'POST',
        httpsAgent: proxyAgent,
        url: 'https://web-edit.us.capcut.com/cc/v1/workspace/join_workspace_with_apply',
        headers: {
            host: 'web-edit.us.capcut.com',
            connection: 'keep-alive',
            appid: '348188',
            'sec-ch-ua-platform': '"Windows"',
            'device-time': '1768280293',
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'store-country-code': 'us',
            loc: 'sg',
            'sign-ver': '1',
            'app-sdk-version': '48.0.0',
            appvr: '5.8.0',
            tdid: '',
            'store-country-code-src': 'uid',
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            sign: 'd837c54d12e51ca2de5f9d29e78bea03',
            lan: 'en',
            pf: '7',
            did: '7594705871117911607',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            origin: 'https://www.capcut.com',
            'sec-fetch-site': 'same-site',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            referer: 'https://www.capcut.com/',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'cookie': sessionCookie
        },
        data: JSON.stringify({
            join_workspace_type: 1,
            invite_link_param: {
                invitation_link: inviteLink
            },
            application_param: {}
        })
    };
    
    const { data } = await axios.request(options);
    return data;
}

module.exports = { loginCapcut, joinTeam, globalAgent };