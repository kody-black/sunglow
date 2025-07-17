import React, { useState, useEffect } from 'react';
import { Cascader, Button, Card, List, Typography, message, Spin, InputNumber, Tag, Row, Col, Typography as AntdTypography, Tooltip } from 'antd';
import axios from 'axios';
import { InfoCircleOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { Text } = AntdTypography;

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

function formatOffset(offset) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(Math.round(offset));
  if (abs < 1) return '（正好）';
  return offset > 0 ? `（+${abs}分钟）` : `（-${abs}分钟）`;
}
function offsetStyle(offset) {
  if (offset === null || offset === undefined) return {};
  const abs = Math.abs(offset);
  if (abs <= 30) return { color: 'green' };
  if (abs <= 90) return { color: 'orange' };
  return { color: 'red', fontWeight: 'bold' };
}

function probabilityColor(prob) {
  if (prob === null || prob === undefined) return 'default';
  if (prob >= 70) return 'volcano';
  if (prob >= 40) return 'orange';
  if (prob >= 20) return 'blue';
  return 'default';
}
function offsetTip(offset) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(offset);
  if (abs > 90) return '（数据点较远，仅供参考）';
  if (abs > 30) return '（数据点有偏差）';
  return '';
}

function formatOffsetText(offset, type) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(Math.round(offset));
  if (abs < 1) return type === 'morning' ? '正好日出时' : '正好日落时';
  return offset < 0
    ? `早于${type === 'morning' ? '日出' : '日落'}${abs}分钟`
    : `晚于${type === 'morning' ? '日出' : '日落'}${abs}分钟`;
}
function offsetTipText(offset) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(offset);
  if (abs > 90) return '，数据点较远，仅供参考';
  if (abs > 30) return '，数据点有偏差';
  return '';
}

function offsetTipType(offset) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(offset);
  if (abs > 90) return 'far';
  if (abs > 30) return 'mid';
  return '';
}
function offsetFullTip(offset, type) {
  if (offset === null || offset === undefined) return '';
  const abs = Math.abs(Math.round(offset));
  let base = '';
  if (abs < 1) base = type === 'morning' ? '正好日出时' : '正好日落时';
  else base = offset < 0
    ? `早于${type === 'morning' ? '日出' : '日落'}${abs}分钟`
    : `晚于${type === 'morning' ? '日出' : '日落'}${abs}分钟`;
  const tipType = offsetTipType(offset);
  if (tipType === 'far') return base + '，数据点与日出/日落时间相差较大，预测结果仅供参考';
  if (tipType === 'mid') return base + '，数据点与日出/日落时间有一定偏差，预测结果可能不够精确';
  return base;
}

function App() {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [cityData, setCityData] = useState([]);
  const [daysInput, setDaysInput] = useState(days);

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
    setSelected(value || []);
    setResult(null);
    if (!value || value.length === 0) return;
    handleQuery(value);
  };

  const handleDaysChange = (value) => {
    setDaysInput(value);
  };
  const handleDaysConfirm = () => {
    if (daysInput !== days) {
      setDays(daysInput);
      if (selected && selected.length > 0) {
        handleQuery(selected, daysInput);
      }
    }
  };

  // 查询逻辑
  const handleQuery = async (value, customDays) => {
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
      const res = await axios.get(`/api/sunglow?city=${encodeURIComponent(cityName)}&days=${customDays || days}`);
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

  // Apple风格渐变背景
  const morningGradient = 'linear-gradient(135deg, #ffe9c6 0%, #fffbe6 100%)';
  const eveningGradient = 'linear-gradient(135deg, #c6e6ff 0%, #e6f7ff 100%)';
  const cardShadow = '0 4px 24px 0 rgba(0,0,0,0.08)';
  const cardBorderRadius = 24;
  const innerCardStyle = {
    borderRadius: cardBorderRadius,
    boxShadow: cardShadow,
    padding: '32px 24px',
    margin: '0 auto',
    minHeight: 260,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
  };

  // 响应式样式
  const responsiveCol = {
    xs: { span: 24 },
    sm: { span: 24 },
    md: { span: 12 },
    lg: { span: 12 },
    xl: { span: 10 },
  };
  const responsiveRow = {
    gutter: [24, 24],
    style: { width: '100%', justifyContent: 'center', flexWrap: 'wrap' },
  };
  const mobileCardStyle = {
    width: '100%',
  };

  const tagStyle = { borderRadius: 12, fontSize: 15, padding: '2px 10px', margin: '2px 4px' };

  return (
    <div style={{ maxWidth: 1200, margin: '40px auto', padding: 24 }}>
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
        value={daysInput}
        onChange={handleDaysChange}
        onBlur={handleDaysConfirm}
        onPressEnter={handleDaysConfirm}
        addonAfter="天"
      />
      <div style={{ marginTop: 32 }}>
        {loading && <Spin tip="查询中..." />}
        {result && (
          <Card title={<span style={{ fontWeight: 600, fontSize: 24, letterSpacing: 2 }}>{result.city} 火烧云概率预测</span>} bordered={false} style={{ boxShadow: cardShadow, borderRadius: cardBorderRadius, background: 'linear-gradient(120deg, #f8fafc 0%, #fff 100%)', marginBottom: 32, maxWidth: 1200, margin: '0 auto' }}>
            <List
              dataSource={result.predictions}
              renderItem={item => (
                <List.Item style={{ background: 'transparent', border: 'none', marginBottom: 56, padding: 0, justifyContent: 'center' }}>
                  <Row {...responsiveRow}>
                    {/* 早霞块 */}
                    <Col {...responsiveCol} style={{ display: 'flex', justifyContent: 'center' }}>
                      <div style={{ ...innerCardStyle, background: morningGradient, ...mobileCardStyle, boxShadow: '0 2px 12px 0 rgba(255, 200, 100, 0.10)' }}>
                        <Text strong style={{ fontSize: 20, letterSpacing: 1, color: '#d48806', marginBottom: 8 }}>早霞</Text>
                        <Text type="secondary" style={{ fontSize: 14, marginBottom: 8 }}>{item.date}</Text>
                        <Text type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>日出 {item.sunrise_time ? new Date(item.sunrise_time).toLocaleTimeString() : '-'}</Text>
                        <div style={{ margin: '18px 0 12px 0', textAlign: 'center' }}>
                          <Tag color={probabilityColor(item.morning_probability)} style={{ fontSize: 36, fontWeight: 700, borderRadius: 20, padding: '10px 28px', letterSpacing: 2, marginBottom: 8, display: 'inline-flex', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 40 }}>{item.morning_probability !== null ? item.morning_probability : '--'}</span>
                            <span style={{ fontSize: 20, marginLeft: 2 }}>%</span>
                          </Tag>
                          {item.morning_probability !== null && (
                            <Tooltip title={<div><div>{offsetFullTip(item.morning_offset_minutes, 'morning')}</div><div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{offsetTipType(item.morning_offset_minutes) === 'far' ? '数据点与日出/日落时间相差较大，预测结果仅供参考' : offsetTipType(item.morning_offset_minutes) === 'mid' ? '数据点有偏差，结果可能不够精确' : ''}</div></div>}>
                              <InfoCircleOutlined style={{ marginLeft: 10, color: '#bfbfbf', fontSize: 20, verticalAlign: 'middle', transition: 'color 0.2s' }} />
                            </Tooltip>
                          )}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                          <Tag color="blue" style={{ ...tagStyle, fontWeight: 500 }}>{item.weather_morning || '-'}</Tag>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>云量: {item.clouds_morning !== null ? item.clouds_morning + '%' : '-'}</Text>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>湿度: {item.humidity_morning !== null ? item.humidity_morning + '%' : '-'}</Text>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>能见度: {item.visibility_morning !== null ? item.visibility_morning + '米' : '-'}</Text>
                        </div>
                      </div>
                    </Col>
                    {/* 晚霞块 */}
                    <Col {...responsiveCol} style={{ display: 'flex', justifyContent: 'center' }}>
                      <div style={{ ...innerCardStyle, background: eveningGradient, ...mobileCardStyle, boxShadow: '0 2px 12px 0 rgba(100, 200, 255, 0.10)' }}>
                        <Text strong style={{ fontSize: 20, letterSpacing: 1, color: '#1890ff', marginBottom: 8 }}>晚霞</Text>
                        <Text type="secondary" style={{ fontSize: 14, marginBottom: 8 }}>{item.date}</Text>
                        <Text type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>日落 {item.sunset_time ? new Date(item.sunset_time).toLocaleTimeString() : '-'}</Text>
                        <div style={{ margin: '18px 0 12px 0', textAlign: 'center' }}>
                          <Tag color={probabilityColor(item.evening_probability)} style={{ fontSize: 36, fontWeight: 700, borderRadius: 20, padding: '10px 28px', letterSpacing: 2, marginBottom: 8, display: 'inline-flex', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 40 }}>{item.evening_probability !== null ? item.evening_probability : '--'}</span>
                            <span style={{ fontSize: 20, marginLeft: 2 }}>%</span>
                          </Tag>
                          {item.evening_probability !== null && (
                            <Tooltip title={<div><div>{offsetFullTip(item.evening_offset_minutes, 'evening')}</div><div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{offsetTipType(item.evening_offset_minutes) === 'far' ? '数据点与日出/日落时间相差较大，预测结果仅供参考' : offsetTipType(item.evening_offset_minutes) === 'mid' ? '数据点有偏差，结果可能不够精确' : ''}</div></div>}>
                              <InfoCircleOutlined style={{ marginLeft: 10, color: '#bfbfbf', fontSize: 20, verticalAlign: 'middle', transition: 'color 0.2s' }} />
                            </Tooltip>
                          )}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                          <Tag color="blue" style={{ ...tagStyle, fontWeight: 500 }}>{item.weather_evening || '-'}</Tag>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>云量: {item.clouds_evening !== null ? item.clouds_evening + '%' : '-'}</Text>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>湿度: {item.humidity_evening !== null ? item.humidity_evening + '%' : '-'}</Text>
                          <Text type="secondary" style={{ margin: '2px 8px' }}>能见度: {item.visibility_evening !== null ? item.visibility_evening + '米' : '-'}</Text>
                        </div>
                      </div>
                    </Col>
                  </Row>
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