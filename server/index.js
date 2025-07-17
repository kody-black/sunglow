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

function calculateSunglowProbability(weatherData) {
    const { clouds, humidity, visibility } = weatherData;
    let probability = 0;
    if (clouds >= 30 && clouds <= 70) {
        probability += 40 - Math.abs(50 - clouds) * 0.8;
    }
    if (humidity >= 40 && humidity <= 70) {
        probability += 30 - Math.abs(55 - humidity) * 0.6;
    }
    if (visibility > 8000) {
        probability += 30 * (Math.min(visibility, 10000) / 10000);
    }
    return Math.round(probability);
}

async function getWeatherForecast(lat, lon) {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`;
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
        const groupedByDate = {};
        for (const item of forecast.list) {
            const date = moment(item.dt * 1000).format('YYYY-MM-DD');
            if (!groupedByDate[date]) groupedByDate[date] = [];
            groupedByDate[date].push(item);
        }
        const sortedDates = Object.keys(groupedByDate).sort();
        const timezone = forecast.city.timezone || 0;
        for (let i = 0; i < Math.min(days, sortedDates.length); i++) {
            const date = sortedDates[i];
            const items = groupedByDate[date];
            // 用suncalc计算该天的日出日落
            const dateObj = moment(date).toDate();
            const times = SunCalc.getTimes(dateObj, coordinates.latitude, coordinates.longitude);
            // times.sunrise, times.sunset为本地时间Date对象
            // 转为moment并加上城市时区偏移
            const sunriseTime = moment(times.sunrise).utcOffset(timezone / 60);
            const sunsetTime = moment(times.sunset).utcOffset(timezone / 60);
            const sunriseRange = getSunriseTimeRange(sunriseTime);
            const sunsetRange = getSunsetTimeRange(sunsetTime);
            // 早霞
            const morningItem = items.find(item => {
                const t = moment.unix(item.dt).utcOffset(timezone / 60);
                return t.isBetween(sunriseRange.before, sunriseRange.after);
            });
            // 晚霞
            const eveningItem = items.find(item => {
                const t = moment.unix(item.dt).utcOffset(timezone / 60);
                return t.isBetween(sunsetRange.before, sunsetRange.after);
            });
            predictions.push({
                date,
                morning_probability: morningItem ? calculateSunglowProbability({
                    clouds: morningItem.clouds.all,
                    humidity: morningItem.main.humidity,
                    visibility: morningItem.visibility
                }) : null,
                evening_probability: eveningItem ? calculateSunglowProbability({
                    clouds: eveningItem.clouds.all,
                    humidity: eveningItem.main.humidity,
                    visibility: eveningItem.visibility
                }) : null,
                weather_morning: morningItem ? morningItem.weather[0].description : null,
                weather_evening: eveningItem ? eveningItem.weather[0].description : null,
                clouds_morning: morningItem ? morningItem.clouds.all : null,
                clouds_evening: eveningItem ? eveningItem.clouds.all : null,
                humidity_morning: morningItem ? morningItem.main.humidity : null,
                humidity_evening: eveningItem ? eveningItem.main.humidity : null,
                visibility_morning: morningItem ? morningItem.visibility : null,
                visibility_evening: eveningItem ? eveningItem.visibility : null,
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