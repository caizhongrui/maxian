// 天和·灵枢运营驾驶舱 - JavaScript交互功能

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

function initializeDashboard() {
    // 初始化动画效果
    initAnimations();
    
    // 初始化数据更新
    initDataUpdates();
    
    // 初始化交互事件
    initInteractions();
    
    // 初始化图表动画
    initChartAnimations();
}

// 初始化各种动画效果
function initAnimations() {
    // 背景元素动画
    const bgElements = document.querySelectorAll('.bg-element');
    bgElements.forEach((element, index) => {
        animateBackgroundElement(element, index);
    });
    
    // 数字人头像脉冲动画
    const avatars = document.querySelectorAll('.human-avatar');
    avatars.forEach((avatar, index) => {
        animateAvatar(avatar, index);
    });
}

// 背景元素动画
function animateBackgroundElement(element, index) {
    let direction = 1;
    let opacity = 0.3;
    
    setInterval(() => {
        opacity += 0.01 * direction;
        
        if (opacity > 0.5 || opacity < 0.2) {
            direction *= -1;
        }
        
        element.style.opacity = opacity;
    }, 100);
}

// 头像动画
function animateAvatar(avatar, index) {
    let rotation = -15 + (index * 30);
    let scale = 1;
    let direction = 1;
    
    setInterval(() => {
        rotation += 0.5 * direction;
        scale = 1 + Math.abs(Math.sin(rotation * Math.PI / 180)) * 0.1;
        
        avatar.style.transform = `rotate(${rotation}deg) scale(${scale})`;
    }, 50);
}

// 初始化数据更新
function initDataUpdates() {
    // 模拟实时数据更新
    setInterval(updateMetrics, 5000);
    
    // 更新图表数据
    setInterval(updateChartData, 3000);
}

// 更新指标数据
function updateMetrics() {
    const metricValues = document.querySelectorAll('.metric-value');
    
    metricValues.forEach(valueElement => {
        const currentValue = parseFloat(valueElement.textContent.replace(/,/g, '').replace('%', '').replace('s', ''));
        const randomChange = (Math.random() - 0.5) * 0.1; // ±5%的变化
        
        let newValue;
        if (valueElement.textContent.includes('%')) {
            newValue = (currentValue + randomChange).toFixed(1) + '%';
        } else if (valueElement.textContent.includes('s')) {
            newValue = (currentValue + randomChange * 0.1).toFixed(1) + 's';
        } else {
            newValue = Math.max(0, Math.round(currentValue + currentValue * randomChange)).toLocaleString();
        }
        
        // 添加数值变化动画
        animateValueChange(valueElement, newValue);
    });
}

// 数值变化动画
function animateValueChange(element, newValue) {
    element.style.transition = 'all 0.5s ease';
    element.style.transform = 'scale(1.1)';
    element.style.color = '#6a11cb';
    
    setTimeout(() => {
        element.textContent = newValue;
        element.style.transform = 'scale(1)';
        element.style.color = '#ffffff';
    }, 250);
}

// 更新图表数据
function updateChartData() {
    const bars = document.querySelectorAll('.chart-bar');
    
    bars.forEach((bar, index) => {
        const randomHeight = 30 + Math.random() * 70;
        bar.style.height = randomHeight + '%';
        
        // 添加动画效果
        bar.style.transition = 'height 0.8s ease';
        bar.style.background = getRandomGradient();
    });
}

// 获取随机渐变色
function getRandomGradient() {
    const gradients = [
        'linear-gradient(to top, #6a11cb, #2575fc)',
        'linear-gradient(to top, #2196f3, #21cbf3)',
        'linear-gradient(to top, #00bcd4, #00e5ff)',
        'linear-gradient(to top, #9c27b0, #e040fb)',
        'linear-gradient(to top, #673ab7, #7c4dff)'
    ];
    
    return gradients[Math.floor(Math.random() * gradients.length)];
}

// 初始化交互事件
function initInteractions() {
    // 为指标项添加点击效果
    const metricItems = document.querySelectorAll('.metric-item');
    
    metricItems.forEach(item => {
        item.addEventListener('click', function() {
            this.style.boxShadow = '0 15px 35px rgba(106, 17, 203, 0.6)';
            
            setTimeout(() => {
                this.style.boxShadow = '0 10px 25px rgba(106, 17, 203, 0.3)';
            }, 300);
        });
    });
    
    // 为统计卡片添加悬停效果
    const statsCards = document.querySelectorAll('.stats-card');
    
    statsCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px)';
            this.style.boxShadow = '0 15px 35px rgba(106, 17, 203, 0.4)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 10px 25px rgba(106, 17, 203, 0.3)';
        });
    });
    
    // 添加键盘事件监听
    document.addEventListener('keydown', handleKeyPress);
}

// 初始化图表动画
function initChartAnimations() {
    const bars = document.querySelectorAll('.chart-bar');
    
    bars.forEach((bar, index) => {
        // 初始动画延迟
        setTimeout(() => {
            bar.style.animation = 'none';
            bar.offsetHeight; // 触发重排
            bar.style.animation = `chartBarAnimation 2s ${index * 0.2}s infinite alternate`;
        }, 100);
    });
}

// 处理键盘按键
function handleKeyPress(event) {
    switch(event.key) {
        case 'r':
        case 'R':
            // R键刷新数据
            updateMetrics();
            break;
        case 'c':
        case 'C':
            // C键更新图表
            updateChartData();
            break;
        default:
            break;
    }
}

// 添加全局动画控制
function toggleAnimations(enabled) {
    const elements = document.querySelectorAll('*');
    
    elements.forEach(element => {
        if (enabled) {
            element.style.animationPlayState = 'running';
            element.style.transition = '';
        } else {
            element.style.animationPlayState = 'paused';
            element.style.transition = 'none';
        }
    });
}

// 页面可见性变化时暂停/恢复动画
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        toggleAnimations(false);
    } else {
        toggleAnimations(true);
    }
});

// 添加粒子效果到视频展示区域
function addParticleEffect() {
    const videoDisplay = document.querySelector('.video-display');
    const particleContainer = document.createElement('div');
    particleContainer.className = 'particle-container';
    
    // 创建多个粒子
    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 3 + 's';
        particleContainer.appendChild(particle);
    }
    
    videoDisplay.appendChild(particleContainer);
}

// 在页面加载后添加粒子效果
setTimeout(addParticleEffect, 1000);

// 添加时间显示功能
function updateTimeDisplay() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-CN', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    // 如果需要显示时间，可以在这里添加到页面中
    console.log('当前时间:', timeString);
}

// 每秒更新时间
setInterval(updateTimeDisplay, 1000);

// 添加数据刷新功能
function refreshData() {
    console.log('正在刷新数据...');
    updateMetrics();
    updateChartData();
    
    // 触发所有动画重新播放
    const animatedElements = document.querySelectorAll('[class*="animate"]');
    animatedElements.forEach(el => {
        el.style.animation = 'none';
        el.offsetHeight; // 触发重排
        el.style.animation = null;
    });
}

// 导出公共方法
window.TianHeDashboard = {
    refreshData: refreshData,
    updateMetrics: updateMetrics,
    updateChartData: updateChartData
};