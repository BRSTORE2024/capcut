const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { HttpsProxyAgent } = require('https-proxy-agent');
const config = require('./config');

// === HELPER FUNCTIONS ===
function loadDomainsFromFile() {
    try {
        if (! fs.existsSync(config.DOMAINS_FILE)) return [];
        const content = fs.readFileSync(config.DOMAINS_FILE, 'utf8');
        return content.split('\n').map(d => d.trim()).filter(d => d.length > 0);
    } catch (err) {
        return [];
    }
}

function removeDomainFromFile(domainToRemove) {
    try {
        const domains = loadDomainsFromFile();
        const updatedDomains = domains.filter(d => d !== domainToRemove);
        fs.writeFileSync(config.DOMAINS_FILE, updatedDomains.join('\n'), 'utf8');
        console.log(`[SYS] Domain ${domainToRemove} telah dihapus dari domains.txt (Limit 15 Acc tercapai).`);
    } catch (err) {
        console.log(`[ERR] Gagal menghapus domain dari file: ${err.message}`);
    }
}

function validateCapcutLink(link) {
    return link && link.includes('capcut.com');
}

function calculateThreads(accountCount) {
    return accountCount <= 5 ? accountCount : 5;
}

function createRotatingProxyAgent() {
    const sessionId = Math.random().toString(36).substring(2, 10);
    const rotatingUser = `${config.PROXY.user}__cr.${config.PROXY.country}__session-${sessionId}`;
    const proxyUrl = `http://${rotatingUser}:${config.PROXY.pass}@${config.PROXY.host}:${config.PROXY.port}`;
    return {
        agent: new HttpsProxyAgent(proxyUrl, { keepAlive: false }),
        sessionId:  sessionId
    };
}

function generateVerifyFp() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const timestamp = Date.now().toString(36);
    let randomStr = '';
    for (let i = 0; i < 36; i++) {
        randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `verify_${timestamp}_${randomStr}`;
}

function generateRandomDID() {
    let result = '';
    result += Math.floor(Math.random() * 9) + 1;
    for (let i = 0; i < 18; i++) {
        result += Math.floor(Math.random() * 10);
    }
    return result;
}

function getRandomUserAgent() {
    const chromeVersion = Math.floor(Math.random() * (132 - 125) + 125);
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
}

function generateSmartEmail(selectedDomain) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let username = '';
    const len = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < len; i++) {
        username += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${username}@${selectedDomain}`;
}

function encodeCapCut(text) {
    let encoded = '';
    for (let i = 0; i < text.length; i++) {
        const hex = (text.charCodeAt(i) ^ 0x05).toString(16).padStart(2, '0');
        encoded += hex;
    }
    return encoded;
}

function extractCookies(response) {
    if (!response || !response.headers || !response.headers['set-cookie']) return '';
    return response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
}

// === CAPCUT API FUNCTIONS ===
async function getOTPFromEmail(targetEmail, maxRetries = 20, delayMs = 3000) {
    const [username, domain] = targetEmail.split('@');
    console.log(`[MAIL] Menunggu OTP untuk: ${targetEmail}...`);
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get('https://generator.email/', {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language':  'en-US,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Cookie': `surl=${domain}/${username}`,
                },
                timeout: 15000
            });
            
            const $ = cheerio.load(response.data);
            let otp = '';
            
            $('#email-table span').each((idx, el) => {
                const text = $(el).text().trim();
                if (/^\d{6}$/.test(text)) {
                    otp = text;
                    return false;
                }
            });
            
            if (! otp) {
                const bodyText = $('body').text();
                const codeMatch = bodyText.match(/verification code is\s*(\d{6})/i);
                if (codeMatch) otp = codeMatch[1];
            }
            
            if (otp && /^\d{6}$/.test(otp)) {
                console.log(`[MAIL] OTP Ditemukan: ${otp} (${targetEmail})`);
                return otp;
            }
            
        } catch (error) {
            console.log(`[MAIL-ERR] Gagal cek inbox: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    throw new Error('Timeout waiting for OTP');
}

const getBaseConfig = (agent, userAgent) => {
    return {
        baseURL: 'https://login.us.capcut.com',
        httpsAgent: agent,
        proxy: false,
        timeout: 40000,
        headers: {
            'accept': 'application/json, text/javascript',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'appid': '348188',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://www.capcut.com',
            'referer': 'https://www.capcut.com/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode':  'cors',
            'sec-fetch-site': 'same-site',
            'user-agent':  userAgent
        }
    };
};

async function checkEmailRegistered(email, csrfToken, did, cookies, axiosConfig, commonParams) {
    const url = '/passport/web/user/check_email_registered';
    const params = new URLSearchParams({ ...commonParams, mix_mode: '1', email:  email, fixed_mix_mode: '1' });
    try {
        const response = await axios.post(url, params.toString(), {
            ...axiosConfig, params: commonParams, headers: { ...axiosConfig.headers, 'cookie': cookies, 'did': did, 'x-tt-passport-csrf-token': csrfToken }
        });
        return response.data;
    } catch (error) { return error.response?.data; }
}

async function sendVerificationCode(email, password, csrfToken, did, cookies, axiosConfig, commonParams) {
    const url = '/passport/web/email/send_code/';
    const params = new URLSearchParams({ ...commonParams, mix_mode: '1', email:  email, password: password, type: '34', fixed_mix_mode: '1' });
    const response = await axios.post(url, params.toString(), {
        ...axiosConfig, params: commonParams, headers: { ...axiosConfig.headers, 'cookie':  cookies, 'did': did, 'x-tt-passport-csrf-token': csrfToken }
    });
    return response.data;
}

async function registerVerifyLogin(email, code, password, csrfToken, did, cookies, axiosConfig, commonParams) {
    const url = '/passport/web/email/register_verify_login/';
    const bizParam = JSON.stringify({ invite_code: '' });
    const params = new URLSearchParams({
        ...commonParams, mix_mode: '1', email: email, code: code, password: password, type: '34',
        birthday: '2000-04-21', force_user_region: 'US', biz_param: bizParam, fixed_mix_mode: '1'
    });
    const response = await axios.post(url, params.toString(), {
        ...axiosConfig, params: commonParams, headers: { ...axiosConfig.headers, 'cookie': cookies, 'did': did, 'x-tt-passport-csrf-token': csrfToken }
    });
    return { data: response.data, headers: response.headers };
}

async function joinWorkspace(sessionCookies, did, inviteLink, currentAgent, currentUA, maxRetries = 3) {
    const url = 'https://web-edit.us.capcut.com/cc/v1/workspace/join_workspace_with_apply';
    const data = { "join_workspace_type": 1, "invite_link_param": { "invitation_link": inviteLink }, "application_param": {} };
    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
        'app-sdk-version': '48.0.0', 'appid': '348188', 'appvr': '5.8.0',
        'content-type': 'application/json', 'cookie': sessionCookies, 'device-time': '1767378697',
        'did': did, 'lan':  'en', 'loc': 'sg', 'origin': 'https://www.capcut.com',
        'pf': '7', 'referer': 'https://www.capcut.com/',
        'sec-ch-ua': '"Brave";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'sec-fetch-dest':  'empty',
        'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site',
        'sign':  'acdff43c6d57ed26f7a61e594795a38f', 'sign-ver': '1',
        'store-country-code': 'us', 'store-country-code-src': 'uid', 'user-agent': currentUA
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.post(url, data, {
                headers, httpsAgent: currentAgent, proxy: false, timeout: 40000
            });
            if (response.data && response.data.ret === '0') return { success: true, msg: 'Joined' };
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
        } catch (error) {
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    return { success: false, msg: 'Failed' };
}

// === WORKER FUNCTION ===
async function createAccount(domains, inviteLink, password, targetDomain) {
    const proxyData = createRotatingProxyAgent();
    const currentUA = getRandomUserAgent();
    const axiosConfig = getBaseConfig(proxyData.agent, currentUA);
    const did = generateRandomDID();
    
    const commonParams = {
        aid: '348188', account_sdk_source: 'web', sdk_version: '2.1.10-tiktok',
        language: 'en', verifyFp: generateVerifyFp()
    };

    const email = generateSmartEmail(targetDomain);
    console.log(`[PROCESS] Membuat akun: ${email}`);
    
    const csrfToken = Math.random().toString(36).substring(2, 34);
    const initialCookies = `passport_csrf_token=${csrfToken}; passport_csrf_token_default=${csrfToken}; did=${did}`;
    const encodedEmail = encodeCapCut(email);
    const encodedPassword = encodeCapCut(password);

    await checkEmailRegistered(encodedEmail, csrfToken, did, initialCookies, axiosConfig, commonParams);
    await new Promise(r => setTimeout(r, 1500));
    
    await sendVerificationCode(encodedEmail, encodedPassword, csrfToken, did, initialCookies, axiosConfig, commonParams);
    console.log(`[SUCCESS] Code dikirim ke: ${email}`);

    const verificationCode = await getOTPFromEmail(email);
    const encodedCode = encodeCapCut(verificationCode);

    const registerResponse = await registerVerifyLogin(
        encodedEmail, encodedCode, encodedPassword, csrfToken, did, initialCookies, axiosConfig, commonParams
    );

    const sessionCookies = extractCookies(registerResponse);
    const fullCookies = `${initialCookies}; ${sessionCookies}`;

    const joinRes = await joinWorkspace(fullCookies, did, inviteLink, proxyData.agent, currentUA);
    
    if (! joinRes.success) {
        throw new Error(`Join failed: ${joinRes.msg}`);
    }
    
    console.log(`[DONE] Akun Berhasil Joined: ${email}`);
    return { email, password };
}

module.exports = {
    loadDomainsFromFile,
    removeDomainFromFile,
    createAccount
};