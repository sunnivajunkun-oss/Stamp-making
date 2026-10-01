document.addEventListener('DOMContentLoaded', () => {
    const ticketContainer = document.getElementById('ticket-container');
    const imageUpload = document.getElementById('image-upload');
    const stubControls = document.getElementById('stub-controls');
    let currentImageUrl = 'https://picsum.photos/800/600';
    let activeTextEl = null; 

    // 1. 单/双图模式切换 & 显示副券控制器
    document.getElementById('tab-single').addEventListener('click', (e) => {
        e.target.classList.add('active'); document.getElementById('tab-double').classList.remove('active');
        ticketContainer.classList.replace('double-mode', 'single-mode');
        stubControls.style.display = 'none';
    });
    document.getElementById('tab-double').addEventListener('click', (e) => {
        e.target.classList.add('active'); document.getElementById('tab-single').classList.remove('active');
        ticketContainer.classList.replace('single-mode', 'double-mode');
        stubControls.style.display = 'block';
    });

    // 2. 基础面板交互
    document.querySelectorAll('.button-group button[data-style]').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.button-group button[data-style]').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            // 保留单双图类名，替换边框类名
            const mode = ticketContainer.classList.contains('double-mode') ? 'double-mode' : 'single-mode';
            ticketContainer.className = `ticket ${mode} ${button.getAttribute('data-style')}`;
        });
    });

    document.getElementById('width-slider').addEventListener('input', e => { document.getElementById('w-val').textContent = e.target.value; ticketContainer.style.setProperty('--ticket-w', `${e.target.value}px`); });
    document.getElementById('height-slider').addEventListener('input', e => { document.getElementById('h-val').textContent = e.target.value; ticketContainer.style.setProperty('--ticket-h', `${e.target.value}px`); });
    
    // 副券控制
    document.getElementById('stub-color').addEventListener('input', e => { ticketContainer.style.setProperty('--stub-bg', e.target.value); });
    document.getElementById('stub-slider').addEventListener('input', e => { 
        document.getElementById('stub-ratio-val').textContent = e.target.value; 
        ticketContainer.style.setProperty('--stub-ratio', e.target.value); 
    });

    imageUpload.addEventListener('change', e => {
        if (e.target.files[0]) {
            currentImageUrl = URL.createObjectURL(e.target.files[0]);
            document.querySelector('.image-area').style.backgroundImage = `url('${currentImageUrl}')`;
        }
    });

    document.getElementById('font-select').addEventListener('change', e => { if (activeTextEl) activeTextEl.style.fontFamily = e.target.value; });
    document.getElementById('text-color').addEventListener('input', e => { if (activeTextEl) activeTextEl.style.color = e.target.value; });

    // 3. 添加内部元素 (坐标全部初始化为精确像素，解决拖动卡顿)
    const addElement = (className, isText = false) => {
        const el = document.createElement('div');
        el.className = `draggable-item ${className}`;
        const rect = ticketContainer.getBoundingClientRect();
        
        if (isText) {
            el.contentEditable = true; el.innerText = '双击旋转，可修改';
            el.style.fontFamily = document.getElementById('font-select').value;
            el.style.color = document.getElementById('text-color').value;
            el.style.left = `${rect.width / 2}px`; el.style.top = `${rect.height / 2}px`;
            el.setAttribute('data-rot', '0');
            el.addEventListener('focus', () => { activeTextEl = el; });
        } else if (className.includes('punch-hole')) {
            el.style.left = '30px'; el.style.top = '30px';
        } else if (className.includes('horizontal')) {
            el.style.top = `${rect.height / 2}px`; el.style.left = '0px';
        } else if (className.includes('vertical')) {
            const ratio = getComputedStyle(ticketContainer).getPropertyValue('--stub-ratio') || 30;
            el.style.left = `${rect.width * (1 - ratio/100)}px`; // 默认放在分界线上
            el.style.top = '0px';
        }
        ticketContainer.appendChild(el);
    };

    document.getElementById('add-text-btn').addEventListener('click', () => addElement('text-box', true));
    document.getElementById('add-tear-notch').addEventListener('click', () => addElement('tear-notch vertical'));
    document.getElementById('add-holes-line').addEventListener('click', () => addElement('perf-line-holes vertical'));
    document.getElementById('add-punch-hole').addEventListener('click', () => addElement('punch-hole'));

    // 4. 拖拽、删除引擎
    let activeItem = null, startX = 0, startY = 0, initialLeft = 0, initialTop = 0, isDragging = false;

    const startDrag = (e) => {
        if (e.target.classList.contains('draggable-item')) {
            activeItem = e.target;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            startX = clientX; startY = clientY;
            // 精确获取当前 left/top 像素值
            initialLeft = parseFloat(activeItem.style.left) || activeItem.offsetLeft;
            initialTop = parseFloat(activeItem.style.top) || activeItem.offsetTop;
            isDragging = false;
            
            // 防止拖动时触发原生文本选中，除非它已经被选中
            if (document.activeElement !== activeItem && !e.touches) e.preventDefault();
        }
    };

    const doDrag = (e) => {
        if (!activeItem || (document.activeElement === activeItem && !isDragging)) return; 
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const dx = clientX - startX, dy = clientY - startY;
        
        if(Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true; // 判断是否发生了真实拖动

        if (activeItem.classList.contains('horizontal')) activeItem.style.top = `${initialTop + dy}px`;
        else if (activeItem.classList.contains('vertical')) activeItem.style.left = `${initialLeft + dx}px`;
        else { activeItem.style.left = `${initialLeft + dx}px`; activeItem.style.top = `${initialTop + dy}px`; }
    };

    const stopDrag = (e) => {
        if (!activeItem) return;
        if (!isDragging && activeItem.classList.contains('text-box')) {
            activeItem.focus(); // 如果只是点击没有拖动，就进入文字编辑模式
        } else if (isDragging) {
            const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
            const rect = ticketContainer.getBoundingClientRect();
            if (clientX < rect.left - 20 || clientX > rect.right + 20 || clientY < rect.top - 20 || clientY > rect.bottom + 20) activeItem.remove();
        }
        activeItem = null;
    };

    ticketContainer.addEventListener('mousedown', startDrag);
    ticketContainer.addEventListener('touchstart', startDrag, {passive: false});
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('touchmove', doDrag, {passive: false});
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
    ticketContainer.addEventListener('contextmenu', e => { if (e.target.classList.contains('draggable-item')) { e.preventDefault(); e.target.remove(); }});

    // 5. 双击 90 度精准旋转 / 变形
    ticketContainer.addEventListener('dblclick', (e) => {
        const el = e.target;
        if (!el.classList.contains('draggable-item')) return;
        
        if (el.classList.contains('text-box')) {
            // 文字框：每次双击顺时针旋转 90 度
            let rot = parseInt(el.getAttribute('data-rot') || 0);
            rot = (rot + 90) % 360;
            el.setAttribute('data-rot', rot);
            el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
        } 
        else if (el.classList.contains('punch-hole')) el.classList.toggle('large');
        else {
            if (el.classList.contains('horizontal')) { el.classList.replace('horizontal', 'vertical'); el.style.left = '50%'; el.style.top = '0px'; } 
            else { el.classList.replace('vertical', 'horizontal'); el.style.top = '50%'; el.style.left = '0px'; }
        }
    });

    // 6. 终极 Canvas 高清导出引擎 (适配副券比例与文字真旋转)
    document.getElementById('export-btn').addEventListener('click', () => {
        const width = ticketContainer.offsetWidth, height = ticketContainer.offsetHeight;
        const isDouble = ticketContainer.classList.contains('double-mode');
        
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');

        const img = new Image(); img.crossOrigin = "Anonymous"; img.src = currentImageUrl;
        
        img.onload = () => {
            // 裁剪最外层边框
            if (ticketContainer.classList.contains('rounded')) {
                ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, width, height, 20) : ctx.rect(0,0,width,height); ctx.clip();
            }

            // 计算副券精确宽度
            const stubRatio = isDouble ? (parseFloat(getComputedStyle(ticketContainer).getPropertyValue('--stub-ratio')) || 30) : 0;
            const stubW = width * (stubRatio / 100);
            const imgW = width - stubW;

            // 绘制主图
            const scale = Math.max(imgW / img.width, height / img.height);
            const x = (imgW / 2) - (img.width / 2) * scale, y = (height / 2) - (img.height / 2) * scale;
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, imgW, height); ctx.clip(); 
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale); ctx.restore();

            // 绘制副券
            if (isDouble) {
                const stubArea = document.querySelector('.stub-area');
                ctx.fillStyle = getComputedStyle(stubArea).backgroundColor;
                ctx.fillRect(imgW, 0, stubW, height);
                // 绘制分界虚线
                ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
                ctx.beginPath(); ctx.moveTo(imgW, 0); ctx.lineTo(imgW, height); ctx.stroke();
            }

            // 绘制内部元素与真实旋转文字
            Array.from(ticketContainer.children).forEach(el => {
                if (!el.classList.contains('draggable-item')) return;
                const elX = parseFloat(el.style.left) || 0;
                const elY = parseFloat(el.style.top) || 0;

                if (el.classList.contains('text-box')) {
                    const style = getComputedStyle(el);
                    const rot = parseInt(el.getAttribute('data-rot') || 0);
                    
                    ctx.save();
                    ctx.translate(elX, elY); // 将画布中心移动到文字中心
                    ctx.rotate(rot * Math.PI / 180); // 真正旋转画布
                    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                    ctx.fillStyle = style.color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(el.innerText, 0, 0);
                    ctx.restore();
                }
                
                if (el.classList.contains('tear-notch')) {
                    ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
                    ctx.beginPath();
                    if (el.classList.contains('horizontal')) { ctx.moveTo(0, elY); ctx.lineTo(width, elY); } 
                    else { ctx.moveTo(elX, 0); ctx.lineTo(elX, height); }
                    ctx.stroke();
                }
            });

            // 开启橡皮擦模式 (抠出所有透明孔洞)
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'black';

            if (ticketContainer.classList.contains('inverse-rounded')) {
                const r = 15; [ [0,0], [width,0], [0,height], [width,height] ].forEach(pos => { ctx.beginPath(); ctx.arc(pos[0], pos[1], r, 0, Math.PI*2); ctx.fill(); });
            } else if (ticketContainer.classList.contains('stamp')) {
                const r = 5, gap = 15;
                for(let i=0; i<=width; i+=gap) { ctx.beginPath(); ctx.arc(i, 0, r, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(i, height, r, 0, Math.PI*2); ctx.fill(); }
                for(let i=0; i<=height; i+=gap) { ctx.beginPath(); ctx.arc(0, i, r, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(width, i, r, 0, Math.PI*2); ctx.fill(); }
            }

            Array.from(ticketContainer.children).forEach(el => {
                if (!el.classList.contains('draggable-item')) return;
                const elX = parseFloat(el.style.left) || 0;
                const elY = parseFloat(el.style.top) || 0;

                if (el.classList.contains('punch-hole')) {
                    const r = el.offsetWidth / 2;
                    ctx.beginPath(); ctx.arc(elX, elY, r, 0, Math.PI*2); ctx.fill();
                } 
                else if (el.classList.contains('tear-notch')) {
                    const r = 12;
                    if (el.classList.contains('horizontal')) {
                        ctx.beginPath(); ctx.arc(0, elY, r, 0, Math.PI*2); ctx.fill();
                        ctx.beginPath(); ctx.arc(width, elY, r, 0, Math.PI*2); ctx.fill();
                    } else {
                        ctx.beginPath(); ctx.arc(elX, 0, r, 0, Math.PI*2); ctx.fill();
                        ctx.beginPath(); ctx.arc(elX, height, r, 0, Math.PI*2); ctx.fill();
                    }
                }
                else if (el.classList.contains('perf-line-holes')) {
                    const r = 3, gap = 15;
                    if (el.classList.contains('horizontal')) {
                        for (let cx = 0; cx <= width; cx += gap) { ctx.beginPath(); ctx.arc(cx, elY, r, 0, Math.PI*2); ctx.fill(); }
                    } else {
                        for (let cy = 0; cy <= height; cy += gap) { ctx.beginPath(); ctx.arc(elX, cy, r, 0, Math.PI*2); ctx.fill(); }
                    }
                }
            });

            const link = document.createElement('a'); link.download = 'My_Ultimate_Ticket.png';
            link.href = canvas.toDataURL('image/png'); link.click();
        };
        img.onerror = () => alert('导出失败：请先【上传图片】以避免跨域限制！');
    });
});