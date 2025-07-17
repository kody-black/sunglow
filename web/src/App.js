import React, { useState, useEffect } from 'react';
import { Cascader, Button, Card, List, Typography, message, Spin, InputNumber } from 'antd';
import axios from 'axios';

const { Title } = Typography;

// 计算两点间球面距离（单位：米）
function getDistance(lat1, lng1, lat2, lng2) {
  const toRad = v => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function App() {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [cityData, setCityData] = useState([]);

  // 加载城市数据并生成级联结构
  useEffect(() => {
    fetch('/cities.json')
      .then(res => res.json())
      .then(data => {
        setCityData(data);
        // 生成省-市-区三级结构
        const provinces = Array.from(new Set(data.map(item => item.province)));
        const options = provinces.map(province => {
          const cities = Array.from(new Set(data.filter(item => item.province === province).map(item => item.city)));
          return {
            value: province,
            label: province,
            children: cities.map(city => {
              const areas = data.filter(item => item.province === province && item.city === city && item.area)
                .map(item => ({ value: item.area, label: item.area }));
              return {
                value: city,
                label: city,
                children: areas.length > 0 ? areas : undefined
              };
            })
          };
        });
        setOptions(options);
      });
  }, []);

  // 自动定位并查找最近城市
  useEffect(() => {
    if (!cityData.length) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        // 找到最近的城市/区县
        let minDist = Infinity;
        let nearest = null;
        cityData.forEach(item => {
          const dist = getDistance(latitude, longitude, parseFloat(item.lat), parseFloat(item.lng));
          if (dist < minDist) {
            minDist = dist;
            nearest = item;
          }
        });
        if (nearest) {
          // 自动选中级联选择器
          setSelected([nearest.province, nearest.city, nearest.area]);
          handleQuery([nearest.province, nearest.city, nearest.area]);
          message.info(`已为你定位到最近城市：${nearest.province}${nearest.city}${nearest.area || ''}`);
        }
      },
      err => {
        // 用户拒绝定位或失败
        message.warning('无法获取地理位置，需手动选择城市');
      }
    );
    // eslint-disable-next-line
  }, [cityData]);

  // 选择后自动查询
  const handleChange = (value, selectedOptions) => {
    setSelected(value);
    setResult(null);
    if (value.length === 0) return;
    handleQuery(value);
  };

  // 查询逻辑
  const handleQuery = async (value) => {
    let cityName = '';
    if (value.length === 3) {
      cityName = value[2]; // 区/县
    } else if (value.length === 2) {
      cityName = value[1]; // 市
    } else if (value.length === 1) {
      cityName = value[0]; // 省
    }
    if (!cityName) {
      message.warning('请选择城市/区/县');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.get(`/api/sunglow?city=${encodeURIComponent(cityName)}&days=${days}`);
      setResult(res.data);
    } catch (e) {
      if (e.response && e.response.data && e.response.data.error) {
        message.error(e.response.data.error);
      } else {
        message.error('查询失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <Title level={2}>火烧云概率预测</Title>
      <Cascader
        options={options}
        onChange={handleChange}
        placeholder="请选择省/市/区"
        style={{ width: 300 }}
        showSearch
        value={selected}
      />
      <InputNumber
        style={{ width: 100, marginLeft: 8 }}
        min={1}
        max={5}
        value={days}
        onChange={setDays}
        addonAfter="天"
      />
      <div style={{ marginTop: 32 }}>
        {loading && <Spin tip="查询中..." />}
        {result && (
          <Card title={`${result.city} 火烧云预测`} bordered={false}>
            <List
              dataSource={result.predictions}
              renderItem={item => (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <b>日期：</b>{item.date} <b>概率：</b>{item.probability}%<br />
                    <b>天气：</b>{item.weather} <b>云量：</b>{item.clouds}% <b>湿度：</b>{item.humidity}% <b>能见度：</b>{item.visibility}米
                  </div>
                </List.Item>
              )}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

export default App; 