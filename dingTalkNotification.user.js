// ==UserScript==
// @name         钉钉通知公共脚本
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  发送钉钉通知的公共脚本
// @author       张晓东
// @grant        GM_xmlhttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

/**
 * 以下是如何调用公共脚本中的钉钉通知函数的完整示例：
 * 
 * 1. 设置钉钉机器人的 token 和 secret（可以在钉钉机器人管理页面获得）：
 *    const token = 'your_access_token';  // 替换成你的机器人 token
 *    const secret = 'your_secret_key';   // 替换成你的机器人密钥
 * 
 * 2. 设置你想要发送的通知消息：
 *    const message = '这是一个测试消息，钉钉通知已经成功发送！';
 * 
 * 3. 调用钉钉通知发送函数：
 *    // 基本调用
 *    sendDingTalkNotification(token, secret, message, function(response) {
 *        console.log("通知发送结果:", response);
 *    });
 *
 *    // 无回调、无跳过时段
 *    sendDingTalkNotification(token, secret, message);
 *
 *    // 无回调，带跳过时段
 *    sendDingTalkNotification(token, secret, message, undefined, skipPeriods);
 *
 *    // 带跳过时段的调用，22:00-07:30 与 12:00-13:30 不发送
 *    const skipPeriods = [
 *      { start: '22:00', end: '07:30' },
 *      { start: '12:00', end: '13:30' }
 *    ];
 *    sendDingTalkNotification(token, secret, message, function(response) {
 *        console.log("通知发送结果:", response);
 *    }, skipPeriods);
 * 
 * 注意：
 * 1. 你必须在油猴脚本中加上以下两行配置：
 *    @grant        GM_xmlhttpRequest   // 必须允许 GM_xmlhttpRequest 请求权限
 *    @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js  // 必须引入 CryptoJS 库
 */

(function () {
    'use strict';

    /**
     * 发送钉钉通知
     * @param {string} token - 钉钉机器人的access_token
     * @param {string} secret - 钉钉机器人的密钥（加签用）
     * @param {string} message - 要发送的通知消息
     * @param {function} callback - 请求成功后的回调函数
     * @param {Array<{start: string, end: string}>} [skipPeriods] - 可选，跳过发送的时段数组，格式为 [{ start: 'HH:mm', end: 'HH:mm' }]
     */
    function sendDingTalkNotification(token, secret, message, callback, skipPeriods) {
        const normalizedSkipPeriods = Array.isArray(skipPeriods) ? skipPeriods : [];

        // 如果当前时间处于任何跳过时段，则直接返回，不发送通知
        if (isWithinSkipPeriods(normalizedSkipPeriods)) {
            if (callback) callback({ skipped: true, reason: 'within_skip_period', periods: normalizedSkipPeriods });
            return;
        }

        const timestamp = Date.now();  // 当前时间戳 毫秒级

        const body = JSON.stringify({
            "msgtype": "text",
            "text": {
                "content": message
            }
        });

        // 计算签名
        const sign = getDingTalkSign(secret, timestamp);

        // URL 加入正确的签名和时间戳（官方要求）
        const urlWithParams = `https://oapi.dingtalk.com/robot/send?access_token=${token}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

        // 发送 POST 请求
        GM_xmlhttpRequest({
            method: "POST",
            url: urlWithParams,
            headers: {
                "Content-Type": "application/json"
            },
            data: body,
            onload: function (response) {
                console.log('钉钉通知发送成功', response);
                if (callback) callback(response);
            },
            onerror: function (error) {
                console.error('钉钉通知发送失败', error);
                if (callback) callback(error);
            }
        });
    }

    /**
     * 正确签名计算（HMAC-SHA256 + Base64 + URL Encode）
     * 按官方加签要求：timestamp + "\n" + secret
     * @param {string} secret
     * @param {number} timestamp
     * @returns {string} Base64 签名（未 encode）
     */
    function getDingTalkSign(secret, timestamp) {
        // 只用 timestamp 和 secret 计算签名
        const stringToSign = `${timestamp}\n${secret}`;

        // HMAC-SHA256 计算签名
        const hash = CryptoJS.HmacSHA256(stringToSign, secret);

        // Base64 编码
        const base64 = CryptoJS.enc.Base64.stringify(hash);

        return base64;
    }

    /**
     * 判断当前时间是否处于跳过时段
     * @param {Array<{start: string, end: string}>} periods
     * @returns {boolean}
     */
    function isWithinSkipPeriods(periods) {
        if (!periods.length) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        return periods.some(period => {
            if (!period || !period.start || !period.end) return false;

            const startMinutes = parseTimeToMinutes(period.start);
            const endMinutes = parseTimeToMinutes(period.end);
            if (startMinutes === null || endMinutes === null) return false;

            // 同一天内的时段，例如 09:00-18:00
            if (startMinutes <= endMinutes) {
                return currentMinutes >= startMinutes && currentMinutes < endMinutes;
            }

            // 跨天时段，例如 23:00-07:00
            return currentMinutes >= startMinutes || currentMinutes < endMinutes;
        });
    }

    /**
     * 将 "HH:mm" 转成分钟数
     * @param {string} timeStr
     * @returns {number|null}
     */
    function parseTimeToMinutes(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length !== 2) return null;
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    window.sendDingTalkNotification = sendDingTalkNotification;

})();
