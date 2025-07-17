require('dotenv').config();
const axios = require('axios');
const moment = require('moment');
const NodeGeocoder = require('node-geocoder');
const { program } = require('commander');
const fs = require('fs');

// 主要城市坐标映射
const CITY_COORDINATES = {
    '北京': { latitude: 39.9042, longitude: 116.4074 },
    '上海': { latitude: 31.2304, longitude: 121.4737 },
    '广州': { latitude: 23.1291, longitude: 113.2644 },
    '深圳': { latitude: 22.5431, longitude: 114.0579 },
    '成都': { latitude: 30.5728, longitude: 104.0668 }
};

// 配置地理编码器
const geocoder = NodeGeocoder({
    provider: 'openstreetmap'
});

// 从本地 cities.json 查找城市经纬度
function getCityCoordinates(cityName) {
    try {
        const citiesData = JSON.parse(fs.readFileSync('cities.json', 'utf-8'));
        // 先精确查找 city 字段
        let city = citiesData.find(c => c.city === cityName && c.country === '中国');
        if (!city && cityName.endsWith('市')) {
            city = citiesData.find(c => c.city === cityName.replace('市', '') && c.country === '中国');
        }
        if (!city) {
            city = citiesData.find(c => c.city === cityName + '市' && c.country === '中国');
        }
        // 新增：查找 area 字段（如“岷县”）
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
        console.error('读取本地城市经纬度数据失败:', e.message);
        return null;
    }
}

// 计算日落时间前后的时间范围
function getSunsetTimeRange(sunsetTime) {
    const before = moment(sunsetTime).subtract(2, 'hours');
    const after = moment(sunsetTime).add(30, 'minutes');
    return { before, after };
}

// 计算火烧云概率
function calculateSunglowProbability(weatherData, sunsetTime) {
    const { clouds, humidity, visibility } = weatherData;
    
    // 理想条件：
    // - 云量在30-70%之间
    // - 湿度在40-70%之间
    // - 能见度良好（>8000米）
    
    let probability = 0;
    
    // 云量评分 (0-40分)
    if (clouds >= 30 && clouds <= 70) {
        probability += 40 - Math.abs(50 - clouds) * 0.8;
    }
    
    // 湿度评分 (0-30分)
    if (humidity >= 40 && humidity <= 70) {
        probability += 30 - Math.abs(55 - humidity) * 0.6;
    }
    
    // 能见度评分 (0-30分)
    if (visibility > 8000) {
        probability += 30 * (Math.min(visibility, 10000) / 10000);
    }
    
    return Math.round(probability);
}

// 获取天气数据
async function getWeatherForecast(lat, lon) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`;
        console.log('正在请求天气数据...');
        console.log('API 密钥:', process.env.OPENWEATHER_API_KEY ? '已设置' : '未设置');
        
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('API 错误详情:');
            console.error('状态码:', error.response.status);
            console.error('错误信息:', error.response.data);
        }
        console.error('获取天气数据失败:', error.message);
        process.exit(1);
    }
}

// 主函数
async function predictSunglow(cityName, days = 3) {
    try {
        // 优先本地查找城市经纬度
        console.log(`正在查找 ${cityName} 的经纬度...`);
        let coordinates = getCityCoordinates(cityName);
        if (coordinates) {
            console.log(`本地查找成功: 纬度 ${coordinates.latitude}, 经度 ${coordinates.longitude}`);
        } else {
            console.log('本地未找到，尝试在线地理编码...');
            const locations = await geocoder.geocode(cityName);
            if (!locations.length) {
                console.error('未找到该城市，请检查名称或完善本地字典');
                return;
            }
            coordinates = {
                latitude: locations[0].latitude,
                longitude: locations[0].longitude
            };
            console.log(`在线查找成功: 纬度 ${coordinates.latitude}, 经度 ${coordinates.longitude}`);
        }
        
        // 获取天气预报数据
        const forecast = await getWeatherForecast(coordinates.latitude, coordinates.longitude);
        
        // 获取未来几天的预测
        const predictions = [];
        const processedDates = new Set();
        
        for (const item of forecast.list) {
            const date = moment(item.dt * 1000).format('YYYY-MM-DD');
            
            // 如果已经处理过这一天或者超过指定天数，跳过
            if (processedDates.has(date) || processedDates.size >= days) {
                continue;
            }
            
            // 获取日落时间附近的天气数据
            const sunsetTime = moment(item.dt * 1000).hour(18); // 假设日落时间在18点左右
            const timeRange = getSunsetTimeRange(sunsetTime);
            
            if (moment(item.dt * 1000).isBetween(timeRange.before, timeRange.after)) {
                const probability = calculateSunglowProbability(item);
                predictions.push({
                    date,
                    probability,
                    weather: item.weather[0].description,
                    clouds: item.clouds.all,
                    humidity: item.main.humidity,
                    visibility: item.visibility
                });
                processedDates.add(date);
            }
        }
        
        // 输出结果
        console.log(`\n${cityName} 未来 ${days} 天火烧云预测：`);
        console.log('=====================================');
        predictions.forEach(pred => {
            console.log(`\n日期: ${pred.date}`);
            console.log(`火烧云概率: ${pred.probability}%`);
            console.log(`天气状况: ${pred.weather}`);
            console.log(`云量: ${pred.clouds}%`);
            console.log(`湿度: ${pred.humidity}%`);
            console.log(`能见度: ${pred.visibility}米`);
        });
        
    } catch (error) {
        console.error('预测失败:', error.message);
    }
}

// 配置命令行参数
program
    .version('1.0.0')
    .description('预测指定城市的火烧云概率')
    .argument('<city>', '城市名称')
    .option('-d, --days <days>', '预测天数', '3')
    .action((city, options) => {
        predictSunglow(city, parseInt(options.days));
    });

program.parse(process.argv); 