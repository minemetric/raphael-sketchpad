/*
* Raphael SketchPad
* Version 0.6.0
* Copyright (c) 2014 eMetric LLC
* Licensed under the MIT (http://www.opensource.org/licenses/mit-license.php) license.
*
* Requires:
* jQuery	http://jquery.com
* Raphael	http://raphaeljs.com
* JSON		http://www.json.org/js.html
* 
* Versions:
* 0.6.0 - Developed for eMetric platform
* 0.5.1 - Fixed extraneous lines when first line is drawn.
*         Thanks to http://github.com/peterkeating for the fix!
* 0.5.0 - Added freeze_history. Fixed bug with undoing erase actions.
* 0.4.0 - Support undo/redo of strokes, erase, and clear.
*       - Removed input option. To make editors/viewers, set editing option to true/false, respectively.
*         To update an input field, listen to change event and update input field with json function.
*       - Reduce file size V1. Changed stored path info from array into a string in SVG format.
* 0.3.0 - Added erase, supported initializing data from input field.
* 0.2.0 - Added iPhone/iPod Touch support, onchange event, animate.
* 0.1.0 - Started code.
*
*/

/**
* We use this wrapper to control global variables.
* The only global variable we expose is Raphael.sketchpad.
*/
(function (Raphael) {

    /**
    * Function to create SketchPad object.
    */
    Raphael.sketchpad = function (paper, options, isMobile) {
        return new SketchPad(paper, options, isMobile);
    };

    // Current version.
    Raphael.sketchpad.VERSION = '0.5.1';
    var _initializing = false;
    /**
    * The Sketchpad object.
    */

    function isSame(s1, s2) {
        if (((s1.path && s1.path.toString() == s2.path) ||
             (s1.text && s1.text == s2.text) ||
             (s1.r && s1.r == s2.r && s1.cx == s2.cx && s1.cy == s2.cy) ||
             (s1.width && s1.width == s2.width && s1.height == s2.height && s1.x == s2.x && s1.y == s2.y)
            ) && s1.transform.join('') == s2.transform.join(''))
            return true;
        else return false;
    }

    var SketchPad = function (paper, options, isMobile) {
        // Use self to reduce confusion about this.
        var self = this;
        var _t;
        var _count = 0;
        self.IsMobile = isMobile;

        var _options = {
            width: 100,
            height: 100,
            strokes: [],
            editing: true
        };
        jQuery.extend(_options, options);
        _initializing = options.initializing;

        // The Raphael context to draw on.
        var _paper;
        if (paper.raphael && paper.raphael.constructor == Raphael.constructor) {
            _paper = paper;
        } else if (typeof paper == 'string') {
            _paper = Raphael(paper, _options.width, _options.height);
        } else {
            throw 'first argument must be a Raphael object, an element ID, an array with 3 elements';
        }

        // The Raphael SVG canvas.
        var _canvas = _paper.canvas;

        // The HTML element that contains the canvas.
        var _container = $(_canvas).parent();

        // The default pen.
        var _pen = new Pen(_initializing, self);


        // Public Methods
        //-----------------

        self.paper = function () {
            return _paper;
        };

        self.canvas = function () {
            return _canvas;
        };

        self.container = function () {
            return _container;
        };

        self.pen = function (value) {
            if (value === undefined) {
                return _pen;
            }
            _pen = value;
            return self; // function-chaining
        };

        // Convert an SVG path into a string, so that it's smaller when JSONified.
        // This function is used by json().
        function svg_path_to_string(path) {
            var str = '';
            for (var i = 0, n = path.length; i < n; i++) {
                var point = path[i];
                if (point[0] !== 'Z') {
                    str += point[0] + point[1] + ',' + point[2];
                } else {
                    str += 'Z';
                }
            }
            return str;
        }

        // Convert a string into an SVG path. This reverses the above code.
        function string_to_svg_path(str) {
            if (str.indexOf('M') > -1 && str.indexOf('L') > -1 && str.indexOf('Z') > -1 && str.indexOf('V') > -1) return str;
            var path = [];
            var tokens = str.split('L');

            if (tokens.length > 0) {
                var token = tokens[0].replace('M', '');
                var points = token.split(',');
                path.push(['M', parseFloat(points[0]), parseFloat(points[1])]);

                for (var i = 1, n = tokens.length; i < n; i++) {
                    token = tokens[i];
                    points = token.split(',');
                    path.push(['L', parseFloat(points[0]), parseFloat(points[1])]);
                }
            }
            if (str[str.length - 1] === 'Z') path.push('Z');
            return path; 
        }

        self.json = function (value, isinitial) {
            if (value === undefined) {
                for (var i = 0, n = _strokes.length; i < n; i++) {
                    var stroke = _strokes[i];
                    if (typeof stroke.path == 'object') {
                        stroke.path = svg_path_to_string(stroke.path);
                    }
                }
                return JSON.stringify(_strokes);
            }

            return self.strokes(JSON.parse(value), isinitial);
        };


        self.strokes = function (value, isinitial) {
            if (value === undefined) {
                return _strokes;
            }
            if (jQuery.isArray(value)) {
                if (isinitial) {
                    _initialstrokes = value;
                    for (var i = 0, n = _initialstrokes.length; i < n; i++) {
                        var stroke = _initialstrokes[i];
                        if (typeof stroke.path == 'string') {
                            stroke.path = string_to_svg_path(stroke.path);
                        }
                    }
                    _redraw_strokes();
                    //_fire_change();
                    return self;
                }
                _strokes = value;

                for (var i = 0, n = _strokes.length; i < n; i++) {
                    var stroke = _strokes[i];
                    if (typeof stroke.path == 'string') {
                        stroke.path = string_to_svg_path(stroke.path);
                    }
                }
                _action_history.add({
                    type: 'batch',
                    strokes: jQuery.merge([], _strokes) // Make a copy.
                });

                _redraw_strokes();
                _fire_change();
            }
            return self; // function-chaining
        };

        self.freeze_history = function () {
            _action_history.freeze();
        };

        self.undoable = function () {
            return _action_history.undoable();
        };

        self.undo = function () {
            _container.find('.removeInDrawing').remove();
            if (_action_history.undoable()) {
                _action_history.undo();
                _strokes = _action_history.current_strokes();
                _redraw_strokes();
                _fire_change();
            }
            return self; // function-chaining
        };

        self.redoable = function () {
            return _action_history.redoable();
        };

        self.redo = function () {
            _container.find('.removeInDrawing').remove();
            if (_action_history.redoable()) {
                _action_history.redo();
                _strokes = _action_history.current_strokes();
                _redraw_strokes();
                _fire_change();
            }
            return self; // function-chaining
        };

        self.clear = function () {
            _container.find('.removeInDrawing').remove();
            _action_history.add({
                type: 'clear'
            });

            _strokes = [];
            _redraw_strokes();
            _fire_change();

            return self; // function-chaining
        };

        self.animate = function (ms) {
            if (ms === undefined) {
                ms = 500;
            }

            _paper.clear();

            function animate() {
                var stroke = _strokes[i];
                var type = stroke.type;
                _paper[type]()
                    .attr(stroke)
                    .click(_pathclick)
                    .hover(_pathover, _pathout);

                i++;
                if (i < _strokes.length) {
                    setTimeout(animate, ms);
                }
            }

            if (_strokes.length > 0) {
                var i = 0;

                animate();
            }

            return self; // function-chaining
        };

        self.del = function (e, sketchpad) {
            if (_options.editing == 'select' && _t) {
                var stroke = _t.attr();
                stroke.type = _t.type;
                if (stroke.path) stroke.path = stroke.path.toString();
                _action_history.add({
                    type: 'erase',
                    stroke: stroke
                });

                for (var i = 0, n = _strokes.length; i < n; i++) {
                    var s = _strokes[i];
                    if (equiv(s, stroke)) {
                        _strokes.splice(i, 1);
                    }
                }
                _t.remove();
                $(_container).find('.removeInDrawing').remove();
                _fire_change();
            }
        };
        self.updating = function (id, val1, val2) {
            if (_options.editing == 'select') {
                if (_t) {
                    if (id && val1) {
                        _t.attr(id, val1);
                        $(_t[0]).css(id, val2);
                        var stroke = _t.attr();
                        stroke.type = _t.type;
                        var newstroke = _t.attr();
                        newstroke.type = _t.type;
                        if (newstroke.path) newstroke.path = newstroke.path.toString();
                        _action_history.add({
                            type: 'resize',
                            stroke: stroke,
                            newstroke: newstroke
                        });
                        for (var i = 0, n = _strokes.length; i < n; i++) {
                            var s = _strokes[i];
                            if (isSame(s, stroke)) {
                                _strokes[i] = newstroke;
                            }
                        }
                        _fire_change();
                    } else {
                        self.pen().width(parseFloat(_t.attr('stroke-width')));
                        self.pen().color(_t.attr('stroke'));
                        if (_t.attr('fill') != 'none') self.pen().fill(_t.attr('fill'));
                    }
                }
            }
        };

        self.editing = function (mode) {
            if (mode === undefined) {
                return _options.editing;
            }
            if (mode == false) {
                $(_container).find('.removeInDrawing').remove();
                $(_container).parent().unbind('.sketchpad');
                $(document).unbind('.sketchpad');
                return;
            }
            _options.editing = mode;
            if (_options.editing) {
                if (_options.editing == 'erase' || _options.editing == 'select') {
                    if (_pen.textbox) {
                        _pen.textbox.remove();
                        _pen.textbox = null;
                    }
                    $(_container).find('.removeInDrawing').remove();
                    // Cursor is crosshair, so it looks like we can do something.
                    $(_container).css('cursor', 'crosshair');
                    $(_container).parent().unbind('.sketchpad');
                    $(document).unbind('.sketchpad');
                } else {
                    $(_container).parent().unbind('.sketchpad');
                    $(document).unbind('.sketchpad');

                    $(_container).find('.removeInDrawing').remove();
                    // Cursor is crosshair, so it looks like we can do something.
                    $(_container).css('cursor', 'crosshair');

                    $(_container).parent().bind('mousedown.sketchpad', _mousedown);
                    $(_container).parent().bind('mousemove.sketchpad', _mousemove);
                    $(_container).parent().bind('mouseleave.sketchpad', _mouseleave);
                    $(_container).parent().bind('mouseup.sketchpad', _mouseup);
                    $(_container).parent().bind('click.sketchpad', _click);

                    // Handle the case when the mouse is released outside the canvas.
                    //$(document).mouseup(_mouseup);

                    if (self.IsMobile) {
                        $(_container).parent().bind('touchstart.sketchpad', _touchstart);
                        $(_container).parent().bind('touchmove.sketchpad', _touchmove);
                        $(_container).parent().bind('touchend.sketchpad', _touchend);
                    }
                }
            } else {
                // Reverse the settings above.
                $(_container).attr('style', 'cursor:inherit');
                $(_container).parent().unbind('.sketchpad');
                $(document).parent().unbind('.sketchpad');
            }

            return self; // function-chaining
        };

        // Change events
        //----------------

        var _change_fn = function () { };
        self.change = function (fn) {
            if (fn == null || fn === undefined) {
                _change_fn = function () { };
            } else if (typeof fn == 'function') {
                _change_fn = fn;
            }
        };
        self.addDefault = function () {
            var evt = {
                target: self.canvas(),
                pageX: $(self.canvas()).offset().left + 10,
                pageY: $(self.canvas()).offset().top + 10,
                preventDefault: function () { },
                stopPropagation: function () { }
            };
            _mousedown(evt);
            evt.pageY += 10;
            _mousemove(evt);
            evt.pageX += 10;
            _mouseup(evt);
        };
        function _fire_change() {
            _change_fn();
        };

        // Miscellaneous methods
        //------------------

        function _redraw_strokes() {
            _paper.clear();

            for (var i = 0, n = _initialstrokes.length; i < n; i++) {
                var stroke = _initialstrokes[i];
                var type = stroke.type;
                var path = _paper[type]()
					            .attr(stroke)
					            .click(_pathclick)
                                .hover(_pathover, _pathout);
                if (stroke.hsfill) $(path[0]).attr('hsfill', stroke.hsfill);
                if (stroke.shape === 'math') {
                    var params = JSON.parse(stroke.params),
                        children = $(path[0]).children();
                    $(path[0]).attr('class', 'math');
                    children.each(function (index, child) {
                        $(child).attr({
                            'dx': '',
                            'dy': '',
                            'x': params[index].x,
                            'y': params[index].y,
                            'style': params[index].style
                        });
                    });
                }
            }
            for (var i = 0, n = _strokes.length; i < n; i++) {
                var stroke = _strokes[i];
                var type = stroke.type;
                var path = _paper[type]()
					            .attr(stroke)
					            .click(_pathclick)
                                .hover(_pathover, _pathout);
                if (stroke.hsfill) $(path[0]).attr('hsfill', stroke.hsfill);
                if (stroke.shape === 'math') {
                    var params = JSON.parse(stroke.params),
                        children = $(path[0]).children();
                    $(path[0]).attr('class', 'math');
                    children.each(function (index, child) {
                        $(child).attr({
                            'dx': '',
                            'dy': '',
                            'x': params[index].x,
                            'y': params[index].y,
                            'style': params[index].style
                        });
                    });
                }
            }
        };

        function _disable_user_select() {
            $(_paper.canvas).css("-webkit-user-select", "none");
            $(_paper.canvas).css("-moz-user-select", "none");
            $("body").attr("onselectstart", "return false;");
        }

        function _enable_user_select() {
            $(_paper.canvas).css("-webkit-user-select", "text");
            $(_paper.canvas).css("-moz-user-select", "text");
            $("body").removeAttr("onselectstart");
        }

        // Event handlers
        //-----------------
        // We can only attach events to the container, so do it.
        function _pathover(e) {
            if ((_options.editing == "erase" || _options.editing == "select") && (this.attr('stroke-opacity') !== 0.99 || _initializing)) {
                $(this[0]).css({ 'opacity': parseFloat($(this[0]).css('opacity')) / 2, 'stroke-width': parseFloat($(this[0]).css('stroke-width')) * 2 });
            } else {

            }
        }
        function _pathout(e) {
            if ((_options.editing == "erase" || _options.editing == "select") && (this.attr('stroke-opacity') !== 0.99 || _initializing)) {
                $(this[0]).css({ 'opacity': parseFloat($(this[0]).css('opacity')) * 2, 'stroke-width': parseFloat($(this[0]).css('stroke-width')) / 2 });
            } else {

            }
        }
        function _pathclick(e) {
            if ((this.attr('stroke-opacity') !== 0.99 || _initializing)) {
                if (_options.editing == "select") {
                    _t = this;
                    self.updating();
                    if (self.pathclick_callback) {
                        self.pathclick_callback();
                    }
                    var bb = _t.getBBox();
                    var svg = _container.find('svg');
                    var shape = $(_t[0]).attr('class');
                    $(_container).parent().unbind('mousemove mouseup mouseleave');
                    if (_options.resizeBox) {
                        _options.resizeBox.remove();
                        _options.resizeBox = null;
                    }
                    var stroke = _t.attr();
                    var sx = 1, sy = 1, ox = 0, oy = 0, deg,
                        top, left, width, height, dx, dy;
                    if (stroke.transform.length > 0) {
                        for (var i = 0; i < stroke.transform.length; i++) {
                            if (stroke.transform[i][0] == 's') {
                                sx = stroke.transform[i][1];
                                sy = stroke.transform[i][2];
                            }
                            if (stroke.transform[i][0] == 't') {
                                ox = stroke.transform[i][1];
                                oy = stroke.transform[i][2];
                            }
                            if (stroke.transform[i][0] == 'r') {
                                deg = stroke.transform[i][1];
                            }
                        }
                    }
                    stroke.type = _t.type;
                    if (stroke.path) stroke.path = stroke.path.toString();
                    var strokeWidth = parseInt(_t.attrs['stroke-width']) || 4;
                    var color = _t.attrs['stroke'];
                    color = parseInt(color.substring(1, 7), 16);
                    color = "#444";
                    //color = "rgb(" + (256 - Math.round(color / 256 / 256)) + "," + (256 - (Math.round(color / 256) % 256)) + "," + (256 - color % 256) + ")";
                    if (_container.parent().hasClass('SketchPad')) {
                        _options.resizeBox = $('<div class="removeInDrawing" style="width:' + (bb.width + strokeWidth - 4) + 'px;height:' + (bb.height + strokeWidth - 4) + 'px;left:' + (bb.x + 8 - strokeWidth / 2) + 'px;top:' + (bb.y + 8 - strokeWidth / 2) + 'px;position:absolute;border:dashed 2px ' + color + ';"></div>');
                    } else {
                        _options.resizeBox = $('<div class="removeInDrawing" style="width:' + (bb.width + strokeWidth) + 'px;height:' + (bb.height + strokeWidth) + 'px;left:' + (bb.x - strokeWidth / 2) + 'px;top:' + (bb.y - strokeWidth / 2) + 'px;position:absolute;border:dashed 2px ' + color + ';"></div>');
                    }
                    var handler = $('<div style="cursor: nw-resize;width:8px;height:8px;position:absolute;bottom:-4px;right:-4px;border:1px solid black;background-color:white;"></div>');
                    _options.resizeBox.append(handler);
                    _container.append(_options.resizeBox);
                    _options.resizeBox.data('origSize', { width: _options.resizeBox.width(), height: _options.resizeBox.height() });
                    _options.resizeBox.data('origP', _options.resizeBox.position());
                    handler.bind('mousedown touchstart', function (e) {
                        if (self.IsMobile) {
                            e = e.originalEvent;
                            if (e.touches && e.touches.length == 1) {
                                e = e.touches[0];
                            }
                        }
                        _options.resizeBox.data('origPos', { x: e.clientX, y: e.clientY });
                        _options.resizeBox.addClass('resizing');
                    });
                    _options.resizeBox.bind('mousedown touchstart', function (e) {
                        _disable_user_select();
                        stroke = _t.attr();
                        if (self.IsMobile) {
                            e = e.originalEvent;
                            if (e.touches && e.touches.length == 1) {
                                e = e.touches[0];
                            }
                        }
                        if (stroke.transform.length > 0) {
                            for (var i = 0; i < stroke.transform.length; i++) {
                                if (stroke.transform[i][0] == 's') {
                                    sx = stroke.transform[i][1];
                                    sy = stroke.transform[i][2];
                                }
                                if (stroke.transform[i][0] == 't') {
                                    ox = stroke.transform[i][1];
                                    oy = stroke.transform[i][2];
                                }
                            }
                        }
                        bb = _t.getBBox();
                        if (_container.parent().hasClass('SketchPad')) {
                            _options.resizeBox.css({
                                width: bb.width + strokeWidth - 4,
                                height: bb.height + strokeWidth - 4,
                                top: bb.y + 8 - strokeWidth / 2,
                                left: bb.x + 8 - strokeWidth / 2
                            });
                        } else {
                            _options.resizeBox.css({
                                width: bb.width + strokeWidth,
                                height: bb.height + strokeWidth,
                                top: bb.y - strokeWidth / 2,
                                left: bb.x - strokeWidth / 2
                            });
                        }
                        _options.resizeBox.data('origSize', { width: _options.resizeBox.width(), height: _options.resizeBox.height() });
                        _options.resizeBox.data('origP', _options.resizeBox.position());
                        _options.resizeBox.data('origPos', { x: e.clientX, y: e.clientY });
                        _options.resizeBox.addClass('moving');
                    });

                    $(_container).parent().bind('mousemove touchmove', function (e) {
                        if (_options.resizeBox) {
                            if (self.IsMobile) {
                                e = e.originalEvent.changedTouches[0];
                            }
                            if (_options.resizeBox.hasClass('resizing')) {
                                dx = e.clientX - _options.resizeBox.data('origPos').x;
                                dy = e.clientY - _options.resizeBox.data('origPos').y;
                                width = _options.resizeBox.data('origSize').width + 2 * dx;
                                height = _options.resizeBox.data('origSize').height + 2 * dy;
                                top = _options.resizeBox.data('origP').top - dy;
                                left = _options.resizeBox.data('origP').left - dx;
                                if (top < 5) {
                                    height -= 2 * (5 - top);
                                    top = 5;
                                }
                                if (left < 5) {
                                    width -= 2 * (5 - left);
                                    left = 5;
                                }
                                if (width + left > svg.width()) {
                                    dx = width - svg.width() + left;
                                    left += dx;
                                    width -= 2 * dx;
                                }
                                if (height + top > svg.height()) {
                                    dy = height - svg.height() + top;
                                    top += dy;
                                    height -= 2 * dy;
                                }
                                if (width < 20 || width < _options.resizeBox.data('origSize').width * 0.1) {
                                    width = Math.max(20, width < _options.resizeBox.data('origSize').width * 0.1);
                                    left = _options.resizeBox.data('origP').left + (_options.resizeBox.data('origSize').width - width) / 2;
                                }
                                if (height < 20 || height < _options.resizeBox.data('origSize').height * 0.1) {
                                    height = Math.max(20, height < _options.resizeBox.data('origSize').height * 0.1);
                                    top = _options.resizeBox.data('origP').top + (_options.resizeBox.data('origSize').height - height) / 2;
                                }
                                _options.resizeBox.css({
                                    width: width,
                                    height: height,
                                    top: top,
                                    left: left
                                });
                                _t.transform('t' + ox + ',' + oy + 's' + sx * _options.resizeBox.width() / _options.resizeBox.data('origSize').width + ',' + sy * _options.resizeBox.height() / _options.resizeBox.data('origSize').height);
                            } else if (_options.resizeBox.hasClass('moving')) {
                                dx = e.clientX - _options.resizeBox.data('origPos').x;
                                dy = e.clientY - _options.resizeBox.data('origPos').y;
                                top = _options.resizeBox.data('origP').top + dy;
                                left = _options.resizeBox.data('origP').left + dx;
                                if (top < 5) top = 5;
                                else if (top + _options.resizeBox.height() > svg.height()) top = svg.height() - _options.resizeBox.height();
                                if (left < 5) left = 5;
                                else if (left + _options.resizeBox.width() > svg.width()) left = svg.width() - _options.resizeBox.width();
                                dy = top - _options.resizeBox.data('origP').top;
                                dx = left - _options.resizeBox.data('origP').left;
                                _options.resizeBox.css({
                                    top: top,
                                    left: left
                                });
                                _t.transform('t' + (ox + dx) + ',' + (oy + dy) + 's' + sx + ',' + sy);
                            }
                        }
                    }).bind('mouseup mouseleave touchend', function (e) {
                        if (_options.resizeBox) {
                            if (_options.resizeBox.hasClass('resizing')) {
                                dx = e.clientX - _options.resizeBox.data('origPos').x;
                                dy = e.clientY - _options.resizeBox.data('origPos').y;
                                width = _options.resizeBox.data('origSize').width + 2 * dx + 3;
                                height = _options.resizeBox.data('origSize').height + 2 * dy + 3;
                                top = _options.resizeBox.data('origP').top - dy;
                                left = _options.resizeBox.data('origP').left - dx;
                                if (top < 5) {
                                    height -= 2 * (5 - top);
                                    top = 5;
                                }
                                if (left < 5) {
                                    width -= 2 * (5 - left);
                                    left = 5;
                                }
                                if (width + left > svg.width()) {
                                    dx = width - svg.width() + left;
                                    left += dx;
                                    width -= 2 * dx;
                                }
                                if (height + top > svg.height()) {
                                    dy = height - svg.height() + top;
                                    top += dy;
                                    height -= 2 * dy;
                                }
                                if (width < 20 || width < _options.resizeBox.data('origSize').width * 0.1) {
                                    width = Math.max(20, width < _options.resizeBox.data('origSize').width * 0.1);
                                    left = _options.resizeBox.data('origP').left + (_options.resizeBox.data('origSize').width - width) / 2;
                                }
                                if (height < 20 || height < _options.resizeBox.data('origSize').height * 0.1) {
                                    height = Math.max(20, height < _options.resizeBox.data('origSize').height * 0.1);
                                    top = _options.resizeBox.data('origP').top + (_options.resizeBox.data('origSize').height - height) / 2;
                                }
                                _options.resizeBox.css({
                                    width: width,
                                    height: height,
                                    top: top,
                                    left: left
                                });
                                _t.transform('t' + ox + ',' + oy + 's' + sx * _options.resizeBox.width() / _options.resizeBox.data('origSize').width + ',' + sy * _options.resizeBox.height() / _options.resizeBox.data('origSize').height);

                                var newstroke = _t.attr();
                                if (shape === 'math') {
                                    newstroke.shape = 'math';
                                    var children = $(_t[0]).children(),
                                        params = [];
                                    children.each(function (index, child) {
                                        params.push({
                                            x: $(child).attr('x'),
                                            y: $(child).attr('y'),
                                            style: $(child).attr('style')
                                        });
                                    });
                                    newstroke.params = JSON.stringify(params);
                                }
                                newstroke.type = _t.type;
                                if (newstroke.path) newstroke.path = newstroke.path.toString();
                                _action_history.add({
                                    type: 'resize',
                                    stroke: stroke,
                                    newstroke: newstroke
                                });
                                for (var i = 0, n = _strokes.length; i < n; i++) {
                                    var s = _strokes[i];
                                    if (isSame(s, stroke)) {
                                        _strokes[i] = newstroke;
                                    }
                                }
                                _options.resizeBox.removeClass('resizing');
                                _options.resizeBox.removeClass('moving');
                                _fire_change();
                            } else if (_options.resizeBox.hasClass('moving')) {
                                dx = e.clientX - _options.resizeBox.data('origPos').x;
                                dy = e.clientY - _options.resizeBox.data('origPos').y;
                                top = _options.resizeBox.data('origP').top + dy;
                                left = _options.resizeBox.data('origP').left + dx;
                                if (top < 5) top = 5;
                                else if (top + _options.resizeBox.height() > svg.height()) top = svg.height() - _options.resizeBox.height();
                                if (left < 5) left = 5;
                                else if (left + _options.resizeBox.width() > svg.width()) left = svg.width() - _options.resizeBox.width();
                                dy = top - _options.resizeBox.data('origP').top;
                                dx = left - _options.resizeBox.data('origP').left;
                                _options.resizeBox.css({
                                    top: top,
                                    left: left
                                });
                                _t.transform('t' + (ox + dx) + ',' + (oy + dy) + 's' + sx + ',' + sy);
                                var newstroke = _t.attr();
                                if (shape === 'math') {
                                    newstroke.shape = 'math';
                                    var children = $(_t[0]).children(),
                                        params = [];
                                    children.each(function (index, child) {
                                        params.push({
                                            x: $(child).attr('x'),
                                            y: $(child).attr('y'),
                                            style: $(child).attr('style')
                                        });
                                    });
                                    newstroke.params = JSON.stringify(params);
                                }
                                newstroke.type = _t.type;
                                if (newstroke.path) newstroke.path = stroke.path.toString();
                                _action_history.add({
                                    type: 'move',
                                    stroke: stroke,
                                    newstroke: newstroke
                                });
                                for (var i = 0, n = _strokes.length; i < n; i++) {
                                    var s = _strokes[i];
                                    if (isSame(s, stroke)) {
                                        _strokes[i] = newstroke;
                                    }
                                }
                                _options.resizeBox.removeClass('moving');
                                _fire_change();
                            }
                        }
                    });
                }
            }
        }
        function storeResult(result) {
            if (result && result.type) {
                var path = result.path;
                if (path != null) {
                    path.node.id = _count;
                    _count++;
                    // Add event when clicked.
                    path.click(_pathclick);
                    path.hover(_pathover, _pathout);

                    // Save the stroke.
                    var stroke = path.attr();
                    if (result.type === 'math') {
                        var children = $(path[0]).children(),
                            params = [];
                        stroke.text = "";
                        children.each(function (index, child) {
                            if (index !== 0) {
                                stroke.text += child.textContent;
                                if (index !== children.length - 1) stroke.text += '\n';
                                params.push({
                                    x: $(child).attr('x'),
                                    y: $(child).attr('y'),
                                    style: $(child).attr('style')
                                });
                            }
                        });
                        stroke.params = JSON.stringify(params);
                        stroke.shape = 'math';
                    }
                    stroke.type = path.type;
                    _strokes.push(stroke);
                    _action_history.add({
                        type: "stroke",
                        stroke: stroke
                    });
                    _fire_change();
                }
            }
        }
        function _mousedown(e) {
            var _active = _pen.active();
            if (_active === 'math' || _active === 'label') {
                return;
            }

            if (e.target.localName !== 'input' && !self.IsMobile) {
                e.preventDefault();
                e.stopPropagation();
            }
            _disable_user_select();

            _pen.start(e, self);
        };

        function _mousemove(e) {
            _pen.move(e, self);
        };

        function _mouseup(e) {
            var _active = _pen.active();
            if (_active === 'math' || _active === 'label') {
                return;
            }

            _enable_user_select();

            var result = _pen.finish(e, self);

            storeResult(result);
        };

        function _mouseleave(e) {
            _mouseup(e);
            _disable_user_select();
            //setTimeout(_enable_user_select, 3000);
        };

        function _click(e) {
            var _active = _pen.active();
            if (_active === 'label' || _active === 'math') {
                _pen.start(e, self);
                var res = _pen.finish(e, self);
                storeResult(res);
            }
        };

        function _touchstart(e) {
            var _active = _pen.active();
            if (_active === 'math' || _active === 'label') {
                return;
            }

            if ($(e.target).parent().parent().hasClass('sketchpad-editor') || $(e.target).parent().hasClass('sketchpad-editor')) {
                e = e.originalEvent;
                e.preventDefault();

                if (e.touches.length == 1) {
                    var touch = e.touches[0];
                    _mousedown(touch);
                }
            }
        }

        function _touchmove(e) {
            if ($(e.target).parent().parent().hasClass('sketchpad-editor') || $(e.target).parent().hasClass('sketchpad-editor')) {
                e = e.originalEvent;
                e.preventDefault();

                if (e.touches.length == 1) {
                    var touch = e.touches[0];
                    _mousemove(touch);
                }
            }
        }

        function _touchend(e) {
            var _active = _pen.active();
            if (_active === 'math' || _active === 'label') {
                return;
            }

            if ($(e.target).parent().parent().hasClass('sketchpad-editor') || $(e.target).parent().hasClass('sketchpad-editor')) {
                e = e.originalEvent;
                e.preventDefault();
                if (e.changedTouches.length == 1) {
                    var touch = e.changedTouches[0];
                    _mouseup(touch);
                }
            }
        }

        // Setup
        //--------

        var _action_history = new ActionHistory();

        // Path data
        var _strokes = _options.strokes;
        var _initialstrokes = [];
        if (jQuery.isArray(_strokes) && _strokes.length > 0) {
            _action_history.add({
                type: "init",
                strokes: jQuery.merge([], _strokes)	// Make a clone.
            });
            _redraw_strokes();
        } else {
            _strokes = [];
            _redraw_strokes();
        }

        self.editing(_options.editing);
    };

    var ActionHistory = function () {
        var self = this;

        var _history = [];

        // Index of the last state.
        var _current_state = -1;

        // Index of the freeze state.
        // The freeze state is the state where actions cannot be undone.
        var _freeze_state = -1;

        // The current set of strokes if strokes were to be rebuilt from history.
        // Set to null to force refresh.
        var _current_strokes = null;

        self.add = function (action) {
            if (_current_state + 1 < _history.length) {
                _history.splice(_current_state + 1, _history.length - (_current_state + 1));
            }

            _history.push(action);
            _current_state = _history.length - 1;

            // Reset current strokes.
            _current_strokes = null;
        };

        self.freeze = function (index) {
            if (index === undefined) {
                _freeze_state = _current_state;
            } else {
                _freeze_state = index;
            }
        };

        self.undoable = function () {
            return (_current_state > -1 && _current_state > _freeze_state);
        };

        self.undo = function () {
            if (self.undoable()) {
                _current_state--;

                // Reset current strokes.
                _current_strokes = null;
            }
        };

        self.redoable = function () {
            return _current_state < _history.length - 1;
        };

        self.redo = function () {
            if (self.redoable()) {
                _current_state++;

                // Reset current strokes.
                _current_strokes = null;
            }
        };

        // Rebuild the strokes from history.
        self.current_strokes = function () {
            if (_current_strokes == null) {
                var strokes = [];
                for (var i = 0; i <= _current_state; i++) {
                    var action = _history[i];
                    switch (action.type) {
                        case "init":
                        case "json":
                        case "strokes":
                        case "batch":
                            jQuery.merge(strokes, action.strokes);
                            break;
                        case "stroke":
                            strokes.push(action.stroke);
                            break;
                        case "resize":
                            for (var s = 0, n = strokes.length; s < n; s++) {
                                var stroke = strokes[s];
                                if (isSame(action.stroke, stroke)) {
                                    strokes[s] = action.newstroke;
                                }
                            }
                            break;
                        case "move":
                            for (var s = 0, n = strokes.length; s < n; s++) {
                                var stroke = strokes[s];
                                if (isSame(action.stroke, stroke)) {
                                    strokes[s] = action.newstroke;
                                }
                            }
                            break;
                        case "erase":
                            for (var s = 0, n = strokes.length; s < n; s++) {
                                var stroke = strokes[s];
                                if (equiv(stroke, action.stroke)) {
                                    strokes.splice(s, 1);
                                }
                            }
                            break;
                        case "clear":
                            strokes = [];
                            break;
                    }
                }

                _current_strokes = strokes;
            }
            return _current_strokes;
        };
    };

    /**
    * The default Pen object.
    */
    var Pen = function (initializing, sketchpad) {
        var self = this;

        var _active = "pencil";
        var _fill = "rgba(0,0,0,0)";
        var _color = "#000000";
        var _stroke = 15;
        var _opacity = 1.0 - (initializing ? 0.01 : 0);
        var _width = 3;
        var _offset = null;

        // Drawing state
        var _drawing = false;
        var _c = null;
        var _points = [];
        var _center;
        var _r;
        var scanId, position = { x: null, y: null };

        var preshape, preradius, precenter;

        self.active = function (value) {
            if (value === undefined) {
                return _active;
            }

            _active = value;
            if (self.textbox) {
                self.textbox.remove();
                self.textbox = null;
            }
            _drawing = false;
            return self;
        };
        self.fill = function (value) {
            if (value === undefined) {
                return _fill;
            }

            _fill = value;
            if (self.textbox) {
                self.textbox.css('background', value);
            }
            return self;
        };

        self.color = function (value) {
            if (value === undefined) {
                return _color;
            }

            _color = value;
            if (self.textbox) {
                self.textbox.css('color', value);
            }
            return self;
        };

        self.stroke = function (value) {
            if (value === undefined) {
                return _stroke;
            }

            if (value < 5) {
                value = 5;
            } else if (value > 40) {
                value = 20;
            }
            if (self.textbox) {
                self.textbox.css('font-size', value + 'px');
            }
            _stroke = value;

            return self;
        }

        self.width = function (value) {
            if (value === undefined) {
                return _width;
            }

            if (value < Pen.MIN_WIDTH) {
                value = Pen.MIN_WIDTH;
            } else if (value > Pen.MAX_WIDTH) {
                value = Pen.MAX_WIDTH;
            }

            _width = value;

            return self;
        }

        self.opacity = function (value) {
            if (value === undefined) {
                return _opacity;
            }

            if (value < 0) {
                value = 0;
            } else if (value > 1) {
                value = 1;
            }

            _opacity = value;

            return self;
        }

        self.start = function (e, sketchpad) {
            _offset = $(sketchpad.container()).offset();
            if ($(e.target).closest('.sketchpad-editor').length > 0 && e.pageX < _offset.left + $(sketchpad.canvas()).width() && e.pageY < _offset.top + $(sketchpad.canvas()).height()) {
                _drawing = true;

                if (precenter) precenter.remove();
                if (preshape) preshape.remove();
                if (preradius) preradius.remove();

                var x = e.pageX - _offset.left,
				y = e.pageY - _offset.top;

                if (_active === "pencil") {
                    _points = [];
                    _points.push([x, y]);

                    _c = sketchpad.paper().path();

                    _c.attr({
                        stroke: _color,
                        "stroke-opacity": _opacity,
                        "stroke-width": _width,
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round"
                    });

                } else if (_active === "circle") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "line") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "rectangle") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "star") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "triangle") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "hexagon") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "arrow") {
                    preshape = null;
                    _center = { x: x, y: y };
                    precenter = sketchpad.paper().circle(x, y, _width).attr({ "stroke": _width, "fill": _color });
                } else if (_active === "label") {
                    if (!self.textbox && x > 0 && y > 0 && x < sketchpad.container().width() && y < sketchpad.container().height()) {
                        self._createdLabel = true;
                        var origpos, offset = { x: 0, y: 0 };
                        self.textbox = $('<textarea class="removeInDrawing" style="position:absolute;font-weight: normal;border:solid 1px black;top:' + (y - 5) + 'px;left:' + (x - 5) + 'px;padding:4px;font-family: Arial;font-size:' + _stroke + 'px;color:' + _color + '"></textarea>');
                        sketchpad.container().parent().append(self.textbox);
                        self.textbox.focus();
                        if (!self.IsMobile) {
                            self.textbox.mousedown(function (e) {
                                e.preventDefault();
                                e.stopPropagation();
                                var x = e.clientX, y = e.clientY;
                                if (self.textbox.hasClass('moving')) {
                                    self.textmoving = true;
                                    self.textbox.data('origpos', self.textbox.position());
                                    self.textbox.data('offset', { x: e.clientX, y: e.clientY });
                                }
                            }).mousemove(function (e) {
                                if (!self.textmoving) {
                                    var x = e.offsetX, y = e.offsetY;
                                    if (x < self.textbox.width() + 10 && x > self.textbox.width() && y < self.textbox.height() + 10 && y > self.textbox.height()) {
                                        self.textbox.addClass('resizing');
                                    } else if (x < 5 || x > self.textbox.width() - 5 && y < 5 && y > self.textbox.height() - 5) {
                                        self.textbox.addClass('moving');
                                    }
                                }
                            }).mouseup(function (e) {
                                e.preventDefault();
                                e.stopPropagation();
                                self.textmoving = null;
                                self.textbox.removeClass('resizing').removeClass('moving');
                            }).mouseleave(function (e) {
                                self.textbox.removeClass('resizing').removeClass('moving');
                            });
                            sketchpad.container().mousemove(function (e) {
                                if (self.textmoving && self.textbox) {
                                    var left = self.textbox.data('origpos').left + e.clientX - self.textbox.data('offset').x,
                                top = self.textbox.data('origpos').top + e.clientY - self.textbox.data('offset').y;
                                    if (left > 0 && left < $(this).width() && top > 0 && top < $(this).height()) {
                                        self.textbox.css({ left: left, top: top });
                                    } else {
                                        self.textmoving = null;
                                        self.textbox.removeClass('resizing').removeClass('moving');
                                    }
                                }
                            });
                        }
                    } else {
                        self._createdLabel = false;
                    }
                } else if (_active === "math") {
                    function useExpression() {
                        var ltx = $.trim(self.mathInput.$mathquillEditable.mathquill('latex'));
                        self.mathDiv.text(ltx);
                        self.mathDiv.mathquill();
                        self.mathDiv.unbind('mousedown.mathquill');
                        self.mathInput.$mathEditorDialog.hide();
                        self.mathDiv.css('font-size', _stroke + 'px');
                        sketchpad.container().append(self.mathDiv);
                        self.mathEdited = true;
                    }
                    function cancelExpression() {
                        self.mathInput.$mathEditorDialog.hide();
                    }
                    if (!self.mathDiv) {
                        try {
                            $(document).append("<script type='text/javascript' src='" + tinymce.baseURL + "/plugins/mathquill/js/mathquill.min.js'></script>");
                        } catch (e) {

                        }
                        $('head').append("<link rel='stylesheet' type='text/css' href='" + tinymce.baseURL + "/plugins/mathquill/css/mathkeyboard.css'>");
                        $('head').append("<link rel='stylesheet' type='text/css' href='" + tinymce.baseURL + "/plugins/mathquill/css/mathquill.css'>");
                        self.mathDiv = $('<div class="math" style="position:absolute;top:' + (y + 40) + 'px;left:' + x + 'px;border:1px black dashed;padding:5px;"></div>');
                    } else if (self.mathDiv === -1) {
                        self.mathDiv = $('<div class="math" style="position:absolute;top:' + (y + 40) + 'px;left:' + x + 'px;border:1px black dashed;padding:5px;"></div>');
                    }

                    if (self.mathInput && self.mathInput.$mathEditorDialog) {
                        self.mathInput.$mathEditorDialog.remove();
                        self.mathInput.$mathEditorDialog = null;
                    }
                    if (!self.mathInput) {
                        self.mathInput = new MathInput(useExpression, cancelExpression);
                    }
                    if (!self.mathInput.$mathEditorDialog) {
                        self.mathInput.init('mathSymbolsMini');
                    }
                    self.mathInput.$mathEditorDialog.show();
                    self.mathInput.$mathquillEditable.find('textarea').focus();

                    self.mathInput.$mathEditorDialog.css({
                        top: x,
                        left: y
                    });
                    if ($.fn.hasOwnProperty('mathquill')) {
                        var latex = self.mathDiv.mathquill('latex') || "";
                        self.mathInput.$mathquillEditable.mathquill('latex', latex);
                        self.mathInput.$mathquillEditable.find('textarea').focus();
                    }
                    self.mathDiv.mousedown(function (e) {
                        var x = e.clientX, y = e.clientY;
                        self.mathmoving = true;
                        self.mathDiv.data('origpos', self.mathDiv.position());
                        self.mathDiv.data('offset', { x: e.clientX, y: e.clientY });
                    }).mouseup(function (e) {
                        self.mathmoving = null;
                        self.mathDiv.removeClass('resizing').removeClass('moving');
                        if (Math.abs(self.mathDiv.data('offset').x - e.clientX) + Math.abs(self.mathDiv.data('offset').y - e.clientY) < 10) {
                            self.mathInput.$mathEditorDialog.show();
                        }
                    }).mouseleave(function (e) {
                        self.mathDiv.removeClass('resizing').removeClass('moving');
                    });
                    sketchpad.container().mousemove(function (e) {
                        if (self.mathmoving && self.mathDiv && self.mathDiv != -1) {
                            var left = self.mathDiv.data('origpos').left + e.clientX - self.mathDiv.data('offset').x,
                                top = self.mathDiv.data('origpos').top + e.clientY - self.mathDiv.data('offset').y;
                            if (left > 0 && left < $(this).width() && top > 0 && top < $(this).height()) {
                                self.mathDiv.css({ left: left, top: top });
                            } else {
                                self.mathmoving = null;
                                self.mathDiv.removeClass('resizing').removeClass('moving');
                            }
                        }
                    });
                }

                scanId = setInterval(function () {
                    if (!position.x || !position.y || !_drawing) return;
                    try {
                        var x = position.x, y = position.y;
                        if (_active === "pencil") {
                            if (_c) {
                                _points.push([x, y]);
                                _c.attr({ path: points_to_svg(), "stroke-opacity": _opacity });
                            }
                        } else if (_active === "circle") {
                            _r = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                            if (preshape) preshape.remove();
                            if (preradius) preradius.remove();
                            preshape = sketchpad.paper().circle(_center.x, _center.y, _r).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill });
                            $(preshape[0]).css('stroke-dasharray', '5px');
                            preradius = sketchpad.paper().path("M" + _center.x + "," + _center.y + "L" + x + "," + y).attr({ "stroke-width": _width, "stroke": _color });
                            $(preradius[0]).css('stroke-dasharray', '5px');
                        } else if (_active === "line") {
                            if (preshape) preshape.remove();
                            preshape = sketchpad.paper().path("M" + _center.x + "," + _center.y + "L" + x + "," + y).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill });
                            $(preshape[0]).css('stroke-dasharray', '5px');
                        } else if (_active === "rectangle") {
                            if (preshape) preshape.remove();
                            var width = x - _center.x,
                            height = y - _center.y,
                            left = _center.x + (width > 0 ? 0 : width),
                            top = _center.y + (height > 0 ? 0 : height);

                            preshape = sketchpad.paper().rect(left, top, Math.abs(width), Math.abs(height)).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill });
                            $(preshape[0]).css('stroke-dasharray', '5px');
                        } else if (_active === "star") {
                            if (preshape) preshape.remove();
                            var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                            if (d > 2) {
                                var arg = Math.atan((y - _center.y) / (x - _center.x));
                                if (x < _center.x) arg += Math.PI;
                                var shapestring = "M" + (_center.x + d * Math.cos(arg)) + "," + (_center.y + d * Math.sin(arg));
                                for (var i = 0; i < 5; i++) {
                                    shapestring += "L" + (_center.x + 0.382 * d * Math.cos(arg + 2 * i * Math.PI / 5 + Math.PI / 5)) + "," + (_center.y + 0.382 * d * Math.sin(arg + 2 * i * Math.PI / 5 + Math.PI / 5));
                                    shapestring += "L" + (_center.x + d * Math.cos(arg + 2 * i * Math.PI / 5 + 2 * Math.PI / 5)) + "," + (_center.y + d * Math.sin(arg + 2 * i * Math.PI / 5 + 2 * Math.PI / 5));
                                }

                                preshape = sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round" });
                                $(preshape[0]).css('stroke-dasharray', '5px');
                            }
                        } else if (_active === "triangle") {
                            if (preshape) preshape.remove();
                            var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                            if (d > 2) {
                                var arg = Math.atan((y - _center.y) / (x - _center.x));
                                if (x < _center.x) arg += Math.PI;
                                var shapestring = "M" + _center.x + "," + _center.y + "L" + x + "," + y + "L" + (_center.x + d * Math.cos(arg - Math.PI / 3)) + "," + (_center.y + d * Math.sin(arg - Math.PI / 3));
                                shapestring += "L" + _center.x + "," + _center.y;
                                preshape = sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round" });
                                $(preshape[0]).css('stroke-dasharray', '5px');
                            }
                        } else if (_active === "hexagon") {
                            if (preshape) preshape.remove();
                            var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                            if (d > 2) {
                                var arg = Math.atan((y - _center.y) / (x - _center.x));
                                if (x < _center.x) arg += Math.PI;
                                var shapestring = "M" + x + "," + y;
                                for (var i = 0; i < 6; i++) {
                                    shapestring += "L" + (_center.x + d * Math.cos(arg + i * Math.PI / 3)) + "," + (_center.y + d * Math.sin(arg + i * Math.PI / 3));
                                }
                                shapestring += "L" + x + "," + y;
                                preshape = sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round" });
                                $(preshape[0]).css('stroke-dasharray', '5px');
                            }
                        } else if (_active === "arrow") {
                            if (preshape) preshape.remove();
                            var dx = (x - _center.x) / 2,
                            dy = (y - _center.y) / 2,
                            d = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
                            if (d > 2) {
                                var shapestring = "M" + _center.x + "," + _center.y
                                        + "L" + (_center.x - dy / 2) + "," + (_center.y + dx / 2)
                                        + "L" + (_center.x - dy / 2 + dx) + "," + (_center.y + dx / 2 + dy)
                                        + "L" + (_center.x - dy + dx) + "," + (_center.y + dx + dy)
                                        + "L" + (_center.x + 2 * dx) + "," + (_center.y + 2 * dy)
                                        + "L" + (_center.x + dy + dx) + "," + (_center.y - dx + dy)
                                        + "L" + (_center.x + dy / 2 + dx) + "," + (_center.y - dx / 2 + dy)
                                        + "L" + (_center.x + dy / 2) + "," + (_center.y - dx / 2)
                                        + "L" + _center.x + "," + _center.y;
                                preshape = sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round" }).transform('r' + arg);
                                $(preshape[0]).css('stroke-dasharray', '5px');
                            }
                        }
                    } catch (exp) {

                    }
                }, 20);
            }
        };

        self.finish = function (e, sketchpad) {
            if (_drawing === true && e.pageX < _offset.left + $(sketchpad.canvas()).width() && e.pageY < _offset.top + $(sketchpad.canvas()).height()) {
                var path = null;
                var x = e.pageX - _offset.left,
				y = e.pageY - _offset.top;
                _drawing = false;
                position.x = null;
                position.y = null;
                clearInterval(scanId);

                if (_active === "pencil") {
                    _points.push([x, y]);
                    if (_c != null) {
                        if (_points.length <= 1) {
                            _c.remove();
                        } else {
                            if (_points.length == 2 && Math.abs(_points[0][0] - _points[1][0]) + Math.abs(_points[0][1] - _points[1][1]) < 10) {
                                _c.remove();
                            } else {
                                path = _c;
                            }
                        }
                    }

                    _drawing = false;
                    _c = null;
                    _points = [];

                    return { type: "pencil", path: path };
                } else if (_active === "circle") {
                    if (precenter) precenter.remove();
                    if (preshape) preshape.remove();
                    if (preradius) preradius.remove();
                    _r = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                    if (_r < _width) return { type: "null" };
                    return { type: "circle", path: sketchpad.paper().circle(_center.x, _center.y, _r).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-opacity": _opacity }) };
                } else if (_active === "line") {
                    if (precenter) precenter.remove();
                    if (preshape) preshape.remove();
                    return { type: "line", path: sketchpad.paper().path("M" + _center.x + "," + _center.y + "L" + x + "," + y).attr({ "stroke-width": _width, "stroke": _color, "stroke-opacity": _opacity }) };
                } else if (_active === "rectangle") {
                    _drawing = false;
                    var width = x - _center.x,
                    height = y - _center.y,
                    left = _center.x + (width > 0 ? 0 : width),
                    top = _center.y + (height > 0 ? 0 : height);

                    if (precenter) precenter.remove();
                    if (preshape) preshape.remove();
                    return { type: "rectangle", path: sketchpad.paper().rect(left, top, Math.abs(width), Math.abs(height)).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-opacity": _opacity }) };
                } else if (_active === "star") {
                    var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                    if (d > 2) {
                        var arg = Math.atan((y - _center.y) / (x - _center.x));
                        if (x < _center.x) arg += Math.PI;
                        var shapestring = "M" + (_center.x + d * Math.cos(arg)) + "," + (_center.y + d * Math.sin(arg));
                        for (var i = 0; i < 5; i++) {
                            shapestring += "L" + (_center.x + 0.382 * d * Math.cos(arg + 2 * i * Math.PI / 5 + Math.PI / 5)) + "," + (_center.y + 0.382 * d * Math.sin(arg + 2 * i * Math.PI / 5 + Math.PI / 5));
                            shapestring += "L" + (_center.x + d * Math.cos(arg + 2 * i * Math.PI / 5 + 2 * Math.PI / 5)) + "," + (_center.y + d * Math.sin(arg + 2 * i * Math.PI / 5 + 2 * Math.PI / 5));
                        }
                        shapestring += 'Z';
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                        return { type: "star", path: sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round", "stroke-opacity": _opacity }) };
                    } else {
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                    }
                } else if (_active === "triangle") {
                    var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                    if (d > 2) {
                        var arg = Math.atan((y - _center.y) / (x - _center.x));
                        if (x < _center.x) arg += Math.PI;
                        var shapestring = "M" + _center.x + "," + _center.y + "L" + x + "," + y + "L" + (_center.x + d * Math.cos(arg - Math.PI / 3)) + "," + (_center.y + d * Math.sin(arg - Math.PI / 3));
                        shapestring += "L" + _center.x + "," + _center.y + 'Z';
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                        return { type: "star", path: sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round", "stroke-opacity": _opacity }) };
                    } else {
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                    }
                } else if (_active === "hexagon") {
                    var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2));
                    if (d > 2) {
                        var arg = Math.atan((y - _center.y) / (x - _center.x));
                        if (x < _center.x) arg += Math.PI;
                        var shapestring = "M" + x + "," + y;
                        for (var i = 0; i < 6; i++) {
                            shapestring += "L" + (_center.x + d * Math.cos(arg + i * Math.PI / 3)) + "," + (_center.y + d * Math.sin(arg + i * Math.PI / 3));
                        }
                        shapestring += "L" + x + "," + y + 'Z';
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                        return { type: "hexagon", path: sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round", "stroke-opacity": _opacity }) };
                    } else {
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                    }
                } else if (_active === "arrow") {
                    var d = Math.sqrt(Math.pow(_center.x - x, 2) + Math.pow(_center.y - y, 2)) / 2;
                    var dx = (x - _center.x) / 2,
                        dy = (y - _center.y) / 2,
                        d = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
                    if (d > 2) {
                        var shapestring = "M" + _center.x + "," + _center.y
                                    + "L" + (_center.x - dy / 2) + "," + (_center.y + dx / 2)
                                    + "L" + (_center.x - dy / 2 + dx) + "," + (_center.y + dx / 2 + dy)
                                    + "L" + (_center.x - dy + dx) + "," + (_center.y + dx + dy)
                                    + "L" + (_center.x + 2 * dx) + "," + (_center.y + 2 * dy)
                                    + "L" + (_center.x + dy + dx) + "," + (_center.y - dx + dy)
                                    + "L" + (_center.x + dy / 2 + dx) + "," + (_center.y - dx / 2 + dy)
                                    + "L" + (_center.x + dy / 2) + "," + (_center.y - dx / 2)
                                    + "L" + _center.x + "," + _center.y + 'Z';
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                        return { type: "arrow", path: sketchpad.paper().path(shapestring).attr({ "stroke-width": _width, "stroke": _color, "fill": _fill, "stroke-linejoin": "round", "stroke-opacity": _opacity }).transform('r' + arg) };
                    } else {
                        if (precenter) precenter.remove();
                        if (preshape) preshape.remove();
                    }
                } else if (_active === 'label') {
                    if (!self._createdLabel && self.textbox && $(e.target).closest('.sketchpad-editor').length > 0) {
                        var pos = self.textbox.position(),
                            text = self.textbox.val();
                        self.textbox.remove();
                        self.textbox = null;
                        var path = sketchpad.paper().text(pos.left - 3, pos.top + 3 * ((_stroke - 10) / 6 + 1), text).attr({ "font-size": _stroke, "stroke": _color, "fill": _fill, "stroke-opacity": _opacity });
                        path.transform('t' + path.getBBox().width / 2 + ',0');
                        return { type: "label", path: path };
                    }
                } else if (_active === 'math') {
                    function mathquillToSVG(mathdiv, root, offset, unitWidth) {
                        var children = mathdiv.children();
                        if (children.length > 0) {
                            if (!root) {
                                var root = sketchpad.paper().text(x, y, " ").attr({ 'font-family': '"Times New Roman", Symbola, serif', 'text-anchor': 'start', 'font-size': _stroke });
                                var offset = mathdiv.parent().offset();
                                children.each(function (index, child) {
                                    if (index !== 0) {
                                        mathquillToSVG($(child), root, offset, unitWidth);
                                    }
                                });
                                return root;
                            } else if (mathdiv.hasClass('fraction')) {
                                mathquillToSVG($(children[0]), root, offset, unitWidth);
                                mathquillToSVG($(children[1]), root, offset, unitWidth);
                                var fraleft, width;
                                fraleft = $(children[0]).width() > $(children[1]).width() ? $(children[0]).offset().left + parseInt($(children[0]).css('padding-left')) : $(children[1]).offset().left + parseInt($(children[1]).css('padding-left'));
                                width = Math.max($(children[0]).width(), $(children[1]).width());
                                var res = $(document.createElementNS("http://www.w3.org/2000/svg", "tspan")).attr({ 'x': fraleft - offset.left, 'y': $(children[0]).offset().top - offset.top, 'font-size': _stroke });
                                for (var i = 0; i < width / unitWidth + 0.5; i++) res[0].textContent += '_';
                                $(root[0]).append(res);
                            } else {
                                children.each(function (index, child) {
                                    mathquillToSVG($(child), root, offset, unitWidth);
                                });
                            }
                        } else {
                            if (mathdiv[0].localName === 'var') {
                                var res = $(document.createElementNS("http://www.w3.org/2000/svg", "tspan")).attr({ 'x': mathdiv.offset().left - offset.left, 'y': mathdiv.offset().top - offset.top, 'font-size': _stroke, 'style': 'font-style: italic;' });
                                res[0].textContent = mathdiv.text();
                                $(root[0]).append(res);
                            } else if (mathdiv.hasClass('binary-operator')) {
                                var res = $(document.createElementNS("http://www.w3.org/2000/svg", "tspan")).attr({ 'x': mathdiv.offset().left - offset.left + mathdiv.width()/2, 'y': mathdiv.offset().top - offset.top + parseInt(mathdiv.css('padding-top')), 'font-size': _stroke });
                                res[0].textContent = mathdiv.text();
                                $(root[0]).append(res);
                            } else {
                                var res = $(document.createElementNS("http://www.w3.org/2000/svg", "tspan")).attr({ 'x': mathdiv.offset().left - offset.left, 'y': mathdiv.offset().top - offset.top, 'font-size': _stroke });
                                res[0].textContent = mathdiv.text();
                                $(root[0]).append(res);
                            }
                        }
                    }
                    if (self.mathEdited && self.mathDiv && $(e.target).closest('.sketchpad-editor').length > 0) {
                        var pos = self.mathDiv.position();
                        var testUnit = $('<span>_</span>');
                        self.mathDiv.append(testUnit);
                        var unitWidth = testUnit.width();
                        testUnit.remove();
                        var path = mathquillToSVG(self.mathDiv, null, {}, unitWidth);
                        self.mathEdited = false;
                        self.mathDiv.remove();
                        self.mathDiv = -1;
                        self.mathInput.$mathEditorDialog.remove();
                        self.mathInput = null;
                        if (path) {
                            $(path[0]).attr('class', 'math');
                            return { type: "math", path: path };
                        }
                    }
                }
            }
        };

        self.move = function (e, sketchpad) {
            if (_drawing == true) {
                position.x = e.pageX - _offset.left;
                position.y = e.pageY - _offset.top;
                if (position.x < 0 || position.x > $(sketchpad.canvas()).width() || position.y < 0 || position.y > $(sketchpad.canvas()).height()) {
                    position.x = null;
                    position.y = null;
                    self.leave(e, sketchpad);
                }
            }
        };

        self.leave = function (e, sketchpad) {
            if (_drawing === true) {
                _drawing = false;
                clearInterval(scanId);
                if (precenter) precenter.remove();
                if (preshape) preshape.remove();
                if (preradius) preradius.remove();
                if (_active === 'pencil') {
                    if (_c != null) {
                        _c.remove();
                    }
                    _c = null;
                    _points = [];
                }
                precenter = null;
                preshape = null;
                preradius = null;
                position.x = null;
                position.y = null;
            }
        };

        function points_to_svg() {
            if (_points != null && _points.length > 1) {
                var p = _points[0];
                var path = "M" + p[0] + "," + p[1];
                for (var i = 1, n = _points.length; i < n; i++) {
                    p = _points[i];
                    path += "L" + p[0] + "," + p[1];
                }
                return path;
            } else {
                return "";
            }
        };
    };

    Pen.MAX_WIDTH = 1000;
    Pen.MIN_WIDTH = 0;

    /**
    * Utility to generate string representation of an object.
    */
    function inspect(obj) {
        var str = "";
        for (var i in obj) {
            str += i + "=" + obj[i] + "\n";
        }
        return str;
    }

})(window.Raphael);

Raphael.fn.display = function (elements) {
    for (var i = 0, n = elements.length; i < n; i++) {
        var e = elements[i];
        var type = e.type;
        this[type]().attr(e);
    }
};


/**
* Utility functions to compare objects by Phil Rathe.
* http://philrathe.com/projects/equiv
*/

// Determine what is o.
function hoozit(o) {
    if (o.constructor === String) {
        return "string";

    } else if (o.constructor === Boolean) {
        return "boolean";

    } else if (o.constructor === Number) {

        if (isNaN(o)) {
            return "nan";
        } else {
            return "number";
        }

    } else if (typeof o === "undefined") {
        return "undefined";

        // consider: typeof null === object
    } else if (o === null) {
        return "null";

        // consider: typeof [] === object
    } else if (o instanceof Array) {
        return "array";

        // consider: typeof new Date() === object
    } else if (o instanceof Date) {
        return "date";

        // consider: /./ instanceof Object;
        //           /./ instanceof RegExp;
        //          typeof /./ === "function"; // => false in IE and Opera,
        //                                          true in FF and Safari
    } else if (o instanceof RegExp) {
        return "regexp";

    } else if (typeof o === "object") {
        return "object";

    } else if (o instanceof Function) {
        return "function";
    } else {
        return undefined;
    }
}

// Call the o related callback with the given arguments.
function bindCallbacks(o, callbacks, args) {
    var prop = hoozit(o);
    if (prop) {
        if (hoozit(callbacks[prop]) === "function") {
            return callbacks[prop].apply(callbacks, args);
        } else {
            return callbacks[prop]; // or undefined
        }
    }
}

// Test for equality any JavaScript type.
// Discussions and reference: http://philrathe.com/articles/equiv
// Test suites: http://philrathe.com/tests/equiv
// Author: Philippe RathÃƒÂ© <prathe@gmail.com>

var equiv = function () {

    var innerEquiv; // the real equiv function
    var callers = []; // stack to decide between skip/abort functions


    var callbacks = function () {

        // for string, boolean, number and null
        function useStrictEquality(b, a) {
            if (b instanceof a.constructor || a instanceof b.constructor) {
                // to catch short annotaion VS 'new' annotation of a declaration
                // e.g. var i = 1;
                //      var j = new Number(1);
                return a == b;
            } else {
                return a === b;
            }
        }

        return {
            "string": useStrictEquality,
            "boolean": useStrictEquality,
            "number": useStrictEquality,
            "null": useStrictEquality,
            "undefined": useStrictEquality,

            "nan": function (b) {
                return isNaN(b);
            },

            "date": function (b, a) {
                return hoozit(b) === "date" && a.valueOf() === b.valueOf();
            },

            "regexp": function (b, a) {
                return hoozit(b) === "regexp" &&
                    a.source === b.source && // the regex itself
                    a.global === b.global && // and its modifers (gmi) ...
                    a.ignoreCase === b.ignoreCase &&
                    a.multiline === b.multiline;
            },

            // - skip when the property is a method of an instance (OOP)
            // - abort otherwise,
            //   initial === would have catch identical references anyway
            "function": function () {
                var caller = callers[callers.length - 1];
                return caller !== Object &&
                        typeof caller !== "undefined";
            },

            "array": function (b, a) {
                var i;
                var len;

                // b could be an object literal here
                if (!(hoozit(b) === "array")) {
                    return false;
                }

                len = a.length;
                if (len !== b.length) { // safe and faster
                    return false;
                }
                for (i = 0; i < len; i++) {
                    if (!innerEquiv(a[i], b[i])) {
                        return false;
                    }
                }
                return true;
            },

            "object": function (b, a) {
                var i;
                var eq = true; // unless we can proove it
                var aProperties = [], bProperties = []; // collection of strings

                // comparing constructors is more strict than using instanceof
                if (a.constructor !== b.constructor) {
                    return false;
                }

                // stack constructor before traversing properties
                callers.push(a.constructor);

                for (i in a) { // be strict: don't ensures hasOwnProperty and go deep

                    aProperties.push(i); // collect a's properties

                    if (!innerEquiv(a[i], b[i])) {
                        eq = false;
                    }
                }

                callers.pop(); // unstack, we are done

                for (i in b) {
                    bProperties.push(i); // collect b's properties
                }

                // Ensures identical properties name
                return eq && innerEquiv(aProperties.sort(), bProperties.sort());
            }
        };
    } ();

    innerEquiv = function () { // can take multiple arguments
        var args = Array.prototype.slice.apply(arguments);
        if (args.length < 2) {
            return true; // end transition
        }

        return (function (a, b) {
            if (a === b) {
                return true; // catch the most you can
            } else if (a === null || b === null || typeof a === "undefined" || typeof b === "undefined" || hoozit(a) !== hoozit(b)) {
                return false; // don't lose time with error prone cases
            } else {
                return bindCallbacks(a, callbacks, [b, a]);
            }

            // apply transition with (1..n) arguments
        })(args[0], args[1]) && arguments.callee.apply(this, args.splice(1, args.length - 1));
    };

    return innerEquiv;

} ();
