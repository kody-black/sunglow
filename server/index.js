require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const SunCalc = require('suncalc');

const app = express();
app.use(cors());

// 本地查找城市经纬度
function getCityCoordinates(cityName) {
    try {
        const citiesData = JSON.parse(fs.readFileSync(path.join(__dirname, '../cities.json'), 'utf-8'));
        let city = citiesData.find(c => c.city === cityName && c.country === '中国');
        if (!city && cityName.endsWith('市')) {
            city = citiesData.find(c => c.city === cityName.replace('市', '') && c.country === '中国');
        }
        if (!city) {
            city = citiesData.find(c => c.city === cityName + '市' && c.country === '中国');
        }
        if (!city) {
            city = citiesData.find(c => c.area === cityName && c.country === '中国');
        }
        if (!city && cityName.endsWith('县')) {
            city = citiesData.find(c => c.area === cityName.replace('县', '') && c.country === '中国');
        }
        if (!city) {
            city = citiesData.find(c => c.area === cityName + '县' && c.country === '中国');
        }
        if (city) {
            return {
                latitude: parseFloat(city.lat),
                longitude: parseFloat(city.lng)
            };
        }
        return null;
    } catch (e) {
        return null;
    }
}

function getSunriseTimeRange(sunriseTime) {
    const before = moment(sunriseTime).subtract(2, 'hours');
    const after = moment(sunriseTime).add(30, 'minutes');
    return { before, after };
}

function getSunsetTimeRange(sunsetTime) {
    const before = moment(sunsetTime).subtract(2, 'hours');
    const after = moment(sunsetTime).add(30, 'minutes');
    return { before, after };
}

// 高斯分布评分函数
function gaussianScore(x, mean, std, maxScore) {
    return maxScore * Math.exp(-0.5 * Math.pow((x - mean) / std, 2));
}

// 能见度阶梯评分
function visibilityScore(visibility) {
    if (visibility >= 10000) return 30;
    if (visibility >= 8000) return 20;
    if (visibility >= 5000) return 10;
    return 0;
}

// 云型加分
function cloudTypeBonus(weather) {
    if (!weather || !weather[0]) return 0;
    const desc = (weather[0].description || '').toLowerCase();
    const main = (weather[0].main || '').toLowerCase();
    // cirrus, scattered, few, broken, altocumulus, stratocumulus
    const bonusTypes = ['cirrus', 'scattered', 'few', 'broken', 'altocumulus', 'stratocumulus'];
    for (const type of bonusTypes) {
        if (desc.includes(type) || main.includes(type)) return 10;
    }
    return 0;
}

// 风速评分
function windScore(wind) {
    if (!wind || typeof wind.speed !== 'number') return 0;
    const speed = wind.speed;
    if (speed >= 2 && speed <= 5) return 10; // 适中加分
    if (speed > 10) return -20; // 极大风速减分
    if (speed > 5 && speed <= 10) return 0; // 中等风速不加分
    return 0; // 低风速不加分
}

// 降水类型惩罚
function precipitationPenalty(weather) {
    if (!weather || !weather[0]) return 1;
    const main = (weather[0].main || '').toLowerCase();
    // 雨、雪、雷暴等主天气时概率减半
    const badTypes = ['rain', 'snow', 'thunderstorm', 'drizzle'];
    for (const type of badTypes) {
        if (main.includes(type)) return 0.5;
    }
    return 1;
}

// 主评分函数
function calculateSunglowProbabilityV2(weatherData) {
    const { clouds, humidity, visibility, weather, wind } = weatherData;
    let score = 0;
    // 云量高斯分布，中心50%，std=15
    score += gaussianScore(clouds, 50, 15, 40);
    // 湿度高斯分布，中心50%，std=10
    score += gaussianScore(humidity, 50, 10, 30);
    // 能见度阶梯
    score += visibilityScore(visibility);
    // 云型加分
    score += cloudTypeBonus(weather);
    // 风速评分
    score += windScore(wind);
    // 降水类型惩罚
    score *= precipitationPenalty(weather);
    // 限制最大100，最小0
    return Math.max(0, Math.round(Math.min(score, 100)));
}

function findClosestItem(items, targetTime, maxMinutes = 120) {
    let minDiff = Infinity;
    let closest = null;
    items.forEach(item => {
        const t = moment(item.dt_txt);
        const diff = Math.abs(t.diff(targetTime, 'minutes'));
        if (diff < minDiff && diff <= maxMinutes) {
            minDiff = diff;
            closest = item;
        }
    });
    return closest;
}

// 线性插值函数
function linearInterpolate(x, x0, y0, x1, y1) {
    if (x1 === x0) return y0; // 防止除零
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

// 在窗口内无数据点时，尝试用前后最近两个点做线性插值
function interpolateProbability(items, targetTime, calculateProb) {
    if (!items || items.length === 0) return { probability: null, offset: null };
    // 按时间排序
    const sorted = items.slice().sort((a, b) => moment(a.dt_txt) - moment(b.dt_txt));
    let before = null, after = null;
    for (const item of sorted) {
        const t = moment(item.dt_txt);
        if (t.isSameOrBefore(targetTime)) before = item;
        if (t.isAfter(targetTime)) { after = item; break; }
    }
    if (!before || !after) return { probability: null, offset: null };
    const t0 = moment(before.dt_txt).valueOf();
    const t1 = moment(after.dt_txt).valueOf();
    const y0 = calculateProb({
        clouds: before.clouds.all,
        humidity: before.main.humidity,
        visibility: before.visibility,
        weather: before.weather,
        wind: before.wind
    });
    const y1 = calculateProb({
        clouds: after.clouds.all,
        humidity: after.main.humidity,
        visibility: after.visibility,
        weather: after.weather,
        wind: after.wind
    });
    const x = targetTime.valueOf();
    const prob = linearInterpolate(x, t0, y0, t1, y1);
    // 取距离最近的点的offset
    const offset = Math.abs(x - t0) < Math.abs(x - t1) ? (x - t0) / 60000 : (x - t1) / 60000;
    return { probability: Math.round(prob), offset };
}

// 计算时间窗口内加权平均概率
function getWeightedProbabilityInWindow(items, targetTime, calculateProb, windowMinutes = 120) {
    // 采集窗口内所有点
    const windowItems = items.filter(item => {
        const t = moment(item.dt_txt);
        return Math.abs(t.diff(targetTime, 'minutes')) <= windowMinutes;
    });
    if (windowItems.length === 0) {
        // 尝试插值
        return interpolateProbability(items, targetTime, calculateProb);
    }
    let totalWeight = 0;
    let weightedSum = 0;
    let minOffset = null;
    windowItems.forEach(item => {
        const t = moment(item.dt_txt);
        const offset = t.diff(targetTime, 'minutes');
        // 权重：高斯分布，中心0，std=60分钟
        const weight = Math.exp(-0.5 * Math.pow(offset / 60, 2));
        const prob = calculateProb({
            clouds: item.clouds.all,
            humidity: item.main.humidity,
            visibility: item.visibility,
            weather: item.weather,
            wind: item.wind
        });
        weightedSum += prob * weight;
        totalWeight += weight;
        if (minOffset === null || Math.abs(offset) < Math.abs(minOffset)) {
            minOffset = offset;
        }
    });
    return {
        probability: Math.round(weightedSum / totalWeight),
        offset: minOffset
    };
}

async function getWeatherForecast(lat, lon) {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=zh_cn`;
    const response = await axios.get(url);
    return response.data;
}

app.get('/api/sunglow', async (req, res) => {
    const cityName = req.query.city;
    const days = parseInt(req.query.days || '3');
    if (!cityName) {
        return res.status(400).json({ error: '缺少city参数' });
    }
    const coordinates = getCityCoordinates(cityName);
    if (!coordinates) {
        return res.status(404).json({ error: '未找到该城市' });
    }
    try {
        const forecast = await getWeatherForecast(coordinates.latitude, coordinates.longitude);
        const predictions = [];
        const now = moment(); // 当前本地时间
        // 只保留当前及未来的数据点
        const validList = forecast.list.filter(item => moment(item.dt_txt).isSameOrAfter(now));
        const groupedByDate = {};
        for (const item of validList) {
            const date = item.dt_txt.slice(0, 10); // 'YYYY-MM-DD'
            if (!groupedByDate[date]) groupedByDate[date] = [];
            groupedByDate[date].push(item);
        }
        const sortedDates = Object.keys(groupedByDate).sort();
        for (let i = 0; i < Math.min(days, sortedDates.length); i++) {
            const date = sortedDates[i];
            const items = groupedByDate[date];
            // 用suncalc计算该天的日出日落（本地时间）
            const dateObj = new Date(date + 'T12:00:00'); // 保证是当天
            const times = SunCalc.getTimes(dateObj, coordinates.latitude, coordinates.longitude);
            const sunriseTime = times.sunrise;
            const sunsetTime = times.sunset;
            // 早霞：窗口加权
            const morningResult = getWeightedProbabilityInWindow(items, moment(sunriseTime), calculateSunglowProbabilityV2, 120);
            // 晚霞：窗口加权
            const eveningResult = getWeightedProbabilityInWindow(items, moment(sunsetTime), calculateSunglowProbabilityV2, 120);
            predictions.push({
                date,
                morning_probability: morningResult.probability,
                evening_probability: eveningResult.probability,
                morning_offset_minutes: morningResult.offset,
                evening_offset_minutes: eveningResult.offset,
                weather_morning: morningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunriseTime), 'minutes')) === Math.abs(morningResult.offset)).weather[0].description : null,
                weather_evening: eveningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunsetTime), 'minutes')) === Math.abs(eveningResult.offset)).weather[0].description : null,
                clouds_morning: morningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunriseTime), 'minutes')) === Math.abs(morningResult.offset)).clouds.all : null,
                clouds_evening: eveningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunsetTime), 'minutes')) === Math.abs(eveningResult.offset)).clouds.all : null,
                humidity_morning: morningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunriseTime), 'minutes')) === Math.abs(morningResult.offset)).main.humidity : null,
                humidity_evening: eveningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunsetTime), 'minutes')) === Math.abs(eveningResult.offset)).main.humidity : null,
                visibility_morning: morningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunriseTime), 'minutes')) === Math.abs(morningResult.offset)).visibility : null,
                visibility_evening: eveningResult.probability !== null ? items.find(item => Math.abs(moment(item.dt_txt).diff(moment(sunsetTime), 'minutes')) === Math.abs(eveningResult.offset)).visibility : null,
                sunrise_time: sunriseTime.toISOString(),
                sunset_time: sunsetTime.toISOString()
            });
        }
        res.json({ city: cityName, predictions });
    } catch (e) {
        res.status(500).json({ error: '天气API请求失败', detail: e.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Sunglow API server running at http://localhost:${PORT}`);
}); 