// zampp Control Panel — native macOS window modelled on the XAMPP Control Panel:
// a Module / PID(s) / Port(s) / Actions table, a column of tool buttons on the right and a
// timestamped "[module] message" log underneath. Plain AppKit, talks to the local zampp API.
import AppKit
import Foundation

// MARK: - API model

struct NamedFile: Decodable { let name: String; let path: String }
struct Service: Decodable {
    let id: String
    let name: String
    let description: String
    let installed: Bool
    let version: String?
    let running: Bool
    let pid: Int?
    let ports: [Int]
    let logs: [NamedFile]
    let configs: [NamedFile]
}
struct Urls: Decodable { let web: String; let adminer: String; let phpmyadmin: String?; let mail: String }
struct Panel: Decodable { let port: Int }
struct Settings: Decodable { let panel: Panel }
struct Status: Decodable { let version: String; let home: String; let services: [Service]; let urls: Urls; let settings: Settings }
struct Envelope<T: Decodable>: Decodable { let data: T }
struct ApiErrorBody: Decodable { struct Inner: Decodable { let code: String; let message: String }; let error: Inner }
struct Check: Decodable { let title: String; let level: String; let detail: String; let fix: String? }
struct Listener: Decodable { let command: String; let pid: Int; let address: String; let port: Int }

extension String: @retroactive Error {}

final class API {
    let home: String
    private(set) var token = ""
    private(set) var port = 1980

    init() {
        let env = ProcessInfo.processInfo.environment
        home = (env["ZAMPP_HOME"]?.isEmpty == false) ? env["ZAMPP_HOME"]! : NSHomeDirectory() + "/.zampp"
        reloadConfig()
    }

    func reloadConfig() {
        if let data = FileManager.default.contents(atPath: home + "/secrets.json"),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let t = json["token"] as? String { token = t }
        if let data = FileManager.default.contents(atPath: home + "/state.json"),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let settings = json["settings"] as? [String: Any],
           let panel = settings["panel"] as? [String: Any],
           let p = panel["port"] as? Int { port = p }
    }

    var base: String { "http://127.0.0.1:\(port)" }

    func request(_ method: String, _ path: String, timeout: TimeInterval = 90, completion: @escaping (Result<Data, String>) -> Void) {
        guard let url = URL(string: base + path) else { return completion(.failure("bad url")) }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error = error { return completion(.failure(error.localizedDescription)) }
            guard let http = response as? HTTPURLResponse, let data = data else { return completion(.failure("no response")) }
            if http.statusCode >= 400 {
                let message = (try? JSONDecoder().decode(ApiErrorBody.self, from: data))?.error.message ?? "HTTP \(http.statusCode)"
                return completion(.failure(message))
            }
            completion(.success(data))
        }.resume()
    }

    func get<T: Decodable>(_ path: String, _ type: T.Type, timeout: TimeInterval = 10, completion: @escaping (Result<T, String>) -> Void) {
        request("GET", path, timeout: timeout) { result in
            completion(result.flatMap { data in
                (try? JSONDecoder().decode(Envelope<T>.self, from: data)).map { .success($0.data) } ?? .failure("could not decode \(path)")
            })
        }
    }
}

func findCli() -> String? {
    let env = ProcessInfo.processInfo.environment
    let candidates = [env["ZAMPP_CLI"] ?? "", "/opt/homebrew/bin/zampp", "/usr/local/bin/zampp", NSHomeDirectory() + "/.npm-global/bin/zampp"]
    return candidates.first { !$0.isEmpty && FileManager.default.isExecutableFile(atPath: $0) }
}

func makeIcon() -> NSImage {
    let size = NSSize(width: 256, height: 256)
    let image = NSImage(size: size)
    image.lockFocus()
    NSColor(red: 0.21, green: 0.77, blue: 0.42, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(origin: .zero, size: size), xRadius: 58, yRadius: 58).fill()
    let path = NSBezierPath()
    path.lineWidth = 28
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.move(to: NSPoint(x: 72, y: 176)); path.line(to: NSPoint(x: 184, y: 176)); path.line(to: NSPoint(x: 72, y: 80)); path.line(to: NSPoint(x: 184, y: 80))
    NSColor(red: 0.06, green: 0.07, blue: 0.08, alpha: 1).setStroke()
    path.stroke()
    image.unlockFocus()
    return image
}

// MARK: - Table row (Module | PID(s) | Port(s) | Actions)

let COL_MODULE: CGFloat = 150, COL_PID: CGFloat = 70, COL_PORT: CGFloat = 110

func smallButton(_ title: String, _ target: AnyObject, _ sel: Selector, width: CGFloat = 64) -> NSButton {
    let b = NSButton(title: title, target: target, action: sel)
    b.bezelStyle = .rounded
    b.controlSize = .small
    b.font = NSFont.systemFont(ofSize: 11)
    b.widthAnchor.constraint(equalToConstant: width).isActive = true
    return b
}

func cellLabel(_ text: String, width: CGFloat, bold: Bool = false, mono: Bool = false) -> NSTextField {
    let f = NSTextField(labelWithString: text)
    f.font = mono ? NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular) : NSFont.systemFont(ofSize: 12, weight: bold ? .semibold : .regular)
    f.widthAnchor.constraint(equalToConstant: width).isActive = true
    f.lineBreakMode = .byTruncatingTail
    return f
}

final class ServiceRow: NSView {
    let service: Service
    let module = NSTextField(labelWithString: "")
    let pid = cellLabel("", width: COL_PID, mono: true)
    let ports = cellLabel("", width: COL_PORT, mono: true)
    let toggle: NSButton
    let restart: NSButton
    let admin: NSButton
    let config: NSButton
    let logs: NSButton
    var current: Service

    init(service: Service, target: AnyObject, action: Selector) {
        self.service = service
        self.current = service
        toggle = smallButton("Start", target, action)
        restart = smallButton("Restart", target, action)
        admin = smallButton("Admin", target, action)
        config = smallButton("Config", target, action)
        logs = smallButton("Logs", target, action)
        super.init(frame: .zero)
        module.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        module.alignment = .center
        module.drawsBackground = true
        module.isBezeled = false
        module.wantsLayer = true
        module.layer?.cornerRadius = 4
        module.widthAnchor.constraint(equalToConstant: COL_MODULE).isActive = true
        module.heightAnchor.constraint(equalToConstant: 22).isActive = true
        let stack = NSStackView(views: [module, pid, ports, toggle, restart, admin, config, logs])
        stack.orientation = .horizontal
        stack.spacing = 6
        stack.alignment = .centerY
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 3),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -3),
        ])
        update(service, busy: false)
    }
    required init?(coder: NSCoder) { fatalError() }

    func update(_ s: Service, busy: Bool) {
        current = s
        module.stringValue = s.name
        pid.stringValue = s.pid.map(String.init) ?? ""
        ports.stringValue = s.ports.map(String.init).joined(separator: ", ")
        // XAMPP paints the module cell green while the service runs.
        module.backgroundColor = s.running ? NSColor.systemGreen.withAlphaComponent(0.55) : (s.installed ? NSColor.clear : NSColor.systemOrange.withAlphaComponent(0.3))
        module.textColor = .labelColor
        toggle.title = s.running ? "Stop" : (s.installed ? "Start" : "Install")
        toggle.isEnabled = !busy
        restart.isEnabled = s.running && !busy
        admin.isEnabled = s.running
        config.isEnabled = !s.configs.isEmpty
        logs.isEnabled = true
        toolTip = "\(s.description)\(s.version.map { " — v\($0)" } ?? "")"
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    let api = API()
    var window: NSWindow!
    let rowsStack = NSStackView()
    var rows: [String: ServiceRow] = [:]
    let logView = NSTextView()
    var timer: Timer?
    var lastStatus: Status?
    var lastRunning: [String: Bool] = [:]
    var lastServeAttempt: Date = .distantPast
    var busy: Set<String> = []
    var startAllButton: NSButton!
    var stopAllButton: NSButton!
    var restartAllButton: NSButton!
    let footer = NSTextField(labelWithString: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = makeIcon()
        buildMenu()
        buildWindow()
        log("main", "Initializing zampp Control Panel")
        log("main", "Home: \(api.home)")
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About zampp", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit zampp Control Panel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let stackItem = NSMenuItem(); main.addItem(stackItem)
        let stackMenu = NSMenu(title: "Stack")
        stackMenu.addItem(withTitle: "Start All", action: #selector(startAll), keyEquivalent: "s")
        stackMenu.addItem(withTitle: "Stop All", action: #selector(stopAll), keyEquivalent: "x")
        stackMenu.addItem(withTitle: "Restart All", action: #selector(restartAll), keyEquivalent: "r")
        stackItem.submenu = stackMenu
        NSApp.mainMenu = main
    }

    func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 860, height: 600), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "zampp Control Panel"
        window.center()
        window.minSize = NSSize(width: 820, height: 480)

        // Title bar strip like XAMPP's banner
        let banner = NSTextField(labelWithString: "zampp Control Panel")
        banner.font = NSFont.systemFont(ofSize: 20, weight: .bold)
        let sub = NSTextField(labelWithString: "the open-source XAMPP")
        sub.font = NSFont.systemFont(ofSize: 12)
        sub.textColor = .secondaryLabelColor
        let title = NSStackView(views: [banner, sub])
        title.orientation = .vertical
        title.alignment = .leading
        title.spacing = 0

        // Stack-wide controls at the fingertips
        startAllButton = NSButton(title: "▶  Start All", target: self, action: #selector(startAll))
        stopAllButton = NSButton(title: "■  Stop All", target: self, action: #selector(stopAll))
        restartAllButton = NSButton(title: "↻  Restart All", target: self, action: #selector(restartAll))
        for b in [startAllButton!, stopAllButton!, restartAllButton!] { b.bezelStyle = .rounded; b.controlSize = .large; b.font = NSFont.systemFont(ofSize: 13, weight: .semibold) }
        startAllButton.keyEquivalent = "\r"
        let stackButtons = NSStackView(views: [startAllButton, stopAllButton, restartAllButton])
        stackButtons.spacing = 8
        let top = NSStackView(views: [title, NSView(), stackButtons])
        top.orientation = .horizontal
        top.alignment = .centerY
        (top.views[1]).setContentHuggingPriority(.defaultLow, for: .horizontal)

        // Table header
        let header = NSStackView(views: [
            cellLabel("Module", width: COL_MODULE, bold: true), cellLabel("PID(s)", width: COL_PID, bold: true),
            cellLabel("Port(s)", width: COL_PORT, bold: true), cellLabel("Actions", width: 300, bold: true),
        ])
        header.spacing = 6
        header.edgeInsets = NSEdgeInsets(top: 4, left: 8, bottom: 2, right: 8)
        for v in header.views { (v as? NSTextField)?.textColor = .secondaryLabelColor; (v as? NSTextField)?.alignment = v === header.views[0] ? .center : .left }

        rowsStack.orientation = .vertical
        rowsStack.spacing = 0
        rowsStack.alignment = .leading
        let table = NSStackView(views: [header, rowsStack])
        table.orientation = .vertical
        table.spacing = 0
        table.alignment = .leading
        let tableBox = NSBox()
        tableBox.boxType = .custom
        tableBox.cornerRadius = 6
        tableBox.borderColor = .separatorColor
        tableBox.fillColor = .controlBackgroundColor
        tableBox.contentViewMargins = .zero
        tableBox.contentView = table
        table.translatesAutoresizingMaskIntoConstraints = false
        if let cv = tableBox.contentView {
            NSLayoutConstraint.activate([
                table.leadingAnchor.constraint(equalTo: cv.leadingAnchor), table.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
                table.topAnchor.constraint(equalTo: cv.topAnchor), table.bottomAnchor.constraint(equalTo: cv.bottomAnchor, constant: -4),
            ])
        }

        // Right-hand tool column (XAMPP: Config, Netstat, Shell, Explorer, Services, Help, Quit)
        func tool(_ title: String, _ sel: Selector) -> NSButton {
            let b = NSButton(title: title, target: self, action: sel)
            b.bezelStyle = .rounded
            b.widthAnchor.constraint(equalToConstant: 100).isActive = true
            return b
        }
        let tools = NSStackView(views: [
            tool("Config", #selector(openConfigDir)), tool("Netstat", #selector(netstat)), tool("Shell", #selector(openShell)),
            tool("Explorer", #selector(openExplorer)), tool("Web Panel", #selector(openPanel)), tool("Doctor", #selector(runDoctor)),
            tool("Help", #selector(openHelp)), tool("Quit", #selector(quit)),
        ])
        tools.orientation = .vertical
        tools.spacing = 6
        tools.alignment = .centerX

        let middle = NSStackView(views: [tableBox, tools])
        middle.orientation = .horizontal
        middle.alignment = .top
        middle.spacing = 12

        // Log
        logView.isEditable = false
        logView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        logView.backgroundColor = .textBackgroundColor
        logView.textContainerInset = NSSize(width: 6, height: 6)
        logView.autoresizingMask = [.width]
        logView.isVerticallyResizable = true
        logView.textContainer?.widthTracksTextView = true
        let scroll = NSScrollView()
        scroll.documentView = logView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 140).isActive = true
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        footer.font = NSFont.systemFont(ofSize: 11)
        footer.textColor = .secondaryLabelColor

        let root = NSStackView(views: [top, middle, scroll, footer])
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 10
        root.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 10, right: 14)
        root.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: content.leadingAnchor), root.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            root.topAnchor.constraint(equalTo: content.topAnchor), root.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            top.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
            middle.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
            scroll.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
        ])
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: Log

    enum Tone { case normal, status, error }
    func log(_ module: String, _ message: String, _ tone: Tone = .normal) {
        let fmt = DateFormatter(); fmt.dateFormat = "HH:mm:ss"
        let color: NSColor = tone == .error ? .systemRed : (tone == .status ? .systemBlue : .labelColor)
        let line = NSMutableAttributedString(string: "\(fmt.string(from: Date()))  ", attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: NSColor.secondaryLabelColor])
        line.append(NSAttributedString(string: "[\(module)]".padding(toLength: 16, withPad: " ", startingAt: 0), attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold), .foregroundColor: color]))
        line.append(NSAttributedString(string: "\(message)\n", attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: color]))
        DispatchQueue.main.async {
            self.logView.textStorage?.append(line)
            self.logView.scrollToEndOfDocument(nil)
        }
    }

    // MARK: Refresh

    func refresh() {
        api.get("/api/v1/status", Status.self, timeout: 5) { [weak self] result in
            guard let self = self else { return }
            DispatchQueue.main.async {
                switch result {
                case .success(let status):
                    self.lastStatus = status
                    self.render(status)
                    let running = status.services.filter { $0.running }.count
                    self.footer.stringValue = "zampp \(status.version)   ·   \(running) of \(status.services.count) services running   ·   API 127.0.0.1:\(self.api.port)   ·   \(status.urls.web)"
                    self.startAllButton.isEnabled = running < status.services.count
                    self.stopAllButton.isEnabled = running > 0
                    self.restartAllButton.isEnabled = running > 0
                case .failure(let message):
                    self.footer.stringValue = "API not reachable (\(message))"
                    self.ensureApiRunning()
                }
            }
        }
    }

    func ensureApiRunning() {
        guard Date().timeIntervalSince(lastServeAttempt) > 10 else { return }
        lastServeAttempt = Date()
        api.reloadConfig()
        guard let cli = findCli() else {
            log("main", "API not running and the zampp command was not found. Run `zampp ui` in a terminal.", .error)
            return
        }
        log("main", "Starting the zampp API: \(cli) serve", .status)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: cli)
        p.arguments = ["serve"]
        let logFile = api.home + "/logs/panel.out.log"
        if !FileManager.default.fileExists(atPath: logFile) { FileManager.default.createFile(atPath: logFile, contents: nil) }
        if let handle = FileHandle(forWritingAtPath: logFile) { handle.seekToEndOfFile(); p.standardOutput = handle; p.standardError = handle }
        do { try p.run() } catch { log("main", "Could not start the API: \(error.localizedDescription)", .error) }
    }

    func render(_ status: Status) {
        var seen = Set<String>()
        for (index, service) in status.services.enumerated() {
            seen.insert(service.id)
            if let was = lastRunning[service.id], was != service.running {
                log(service.name, "Status change detected: \(service.running ? "running" : "stopped")", .status)
            }
            lastRunning[service.id] = service.running
            if let row = rows[service.id] {
                row.update(service, busy: busy.contains(service.id))
            } else {
                let row = ServiceRow(service: service, target: self, action: #selector(rowAction(_:)))
                rows[service.id] = row
                rowsStack.insertArrangedSubview(row, at: min(index, rowsStack.arrangedSubviews.count))
                row.widthAnchor.constraint(equalTo: rowsStack.widthAnchor).isActive = true
            }
        }
        for (id, row) in rows where !seen.contains(id) {
            rowsStack.removeArrangedSubview(row); row.removeFromSuperview(); rows.removeValue(forKey: id)
        }
    }

    // MARK: Row actions

    @objc func rowAction(_ sender: NSButton) {
        guard let row = rows.values.first(where: { [$0.toggle, $0.restart, $0.admin, $0.config, $0.logs].contains(sender) }) else { return }
        let s = row.current
        switch sender {
        case row.toggle: serviceAction(s, s.running ? "stop" : "start")
        case row.restart: serviceAction(s, "restart")
        case row.admin: openAdmin(s)
        case row.config:
            if let c = s.configs.first { NSWorkspace.shared.open(URL(fileURLWithPath: c.path)); log(s.name, "Opening \(c.path)") }
        case row.logs:
            let path = s.logs.first(where: { $0.name == "error" || $0.name == "php-fpm" })?.path ?? s.logs.first?.path ?? api.home + "/logs"
            openInConsole(path); log(s.name, "Opening \(path)")
        default: break
        }
    }

    func openAdmin(_ s: Service) {
        guard let st = lastStatus else { return }
        let url: String
        if s.id == "apache" { url = st.urls.web }
        else if s.id == "mariadb" { url = st.urls.phpmyadmin ?? st.urls.adminer }
        else if s.id == "mailpit" { url = st.urls.mail }
        else if s.id.hasPrefix("php-fpm") { url = st.urls.web + "phpinfo.php" }
        else { url = st.urls.web }
        log(s.name, "Opening \(url)")
        if let u = URL(string: url) { NSWorkspace.shared.open(u) }
    }

    func serviceAction(_ s: Service, _ action: String) {
        busy.insert(s.id)
        if let st = lastStatus { render(st) }
        log(s.name, "Attempting to \(action) \(s.name)" + (s.installed ? "…" : " (installing first)…"))
        let encoded = s.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s.id
        api.request("POST", "/api/v1/services/\(encoded)/\(action)", timeout: 600) { [weak self] result in
            guard let self = self else { return }
            DispatchQueue.main.async {
                self.busy.remove(s.id)
                if case .failure(let message) = result { self.log(s.name, "Error: \(message)", .error) }
                self.refresh()
            }
        }
    }

    // MARK: Stack actions

    @objc func startAll() {
        log("main", "Starting all services (anything missing is installed first)…", .status)
        [startAllButton, stopAllButton, restartAllButton].forEach { $0?.isEnabled = false }
        api.request("POST", "/api/v1/stack/start", timeout: 900) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let data):
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let inner = json["data"] as? [String: Any],
                   let failed = inner["failed"] as? [[String: Any]], !failed.isEmpty {
                    for f in failed { self.log("\(f["id"] ?? "")", "Error: \(f["error"] ?? "")", .error) }
                } else { self.log("main", "All services started") }
            case .failure(let message): self.log("main", "Error: \(message)", .error)
            }
            DispatchQueue.main.async { self.refresh() }
        }
    }

    @objc func stopAll() {
        log("main", "Stopping all services…", .status)
        api.request("POST", "/api/v1/stack/stop") { [weak self] result in
            if case .failure(let m) = result { self?.log("main", "Error: \(m)", .error) } else { self?.log("main", "All services stopped") }
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    @objc func restartAll() {
        log("main", "Restarting all services…", .status)
        api.request("POST", "/api/v1/stack/stop") { [weak self] _ in
            self?.api.request("POST", "/api/v1/stack/start", timeout: 900) { result in
                if case .failure(let m) = result { self?.log("main", "Error: \(m)", .error) } else { self?.log("main", "All services restarted") }
                DispatchQueue.main.async { self?.refresh() }
            }
        }
    }

    // MARK: Tools

    @objc func openConfigDir() { NSWorkspace.shared.open(URL(fileURLWithPath: api.home + "/etc")); log("main", "Opening \(api.home)/etc") }
    @objc func openExplorer() { NSWorkspace.shared.open(URL(fileURLWithPath: api.home + "/www")); log("main", "Opening \(api.home)/www") }
    @objc func openShell() {
        let script = "tell application \"Terminal\"\nactivate\ndo script \"cd '\(api.home)' && zampp status\"\nend tell"
        NSAppleScript(source: script)?.executeAndReturnError(nil)
        log("main", "Opening a shell in \(api.home)")
    }
    @objc func openPanel() { if let u = URL(string: "\(api.base)/?token=\(api.token)") { NSWorkspace.shared.open(u) } }
    @objc func openHelp() { if let u = URL(string: "https://github.com/MHK-26/zampp#readme") { NSWorkspace.shared.open(u) } }
    @objc func quit() { NSApp.terminate(nil) }

    @objc func netstat() {
        log("main", "TCP listening sockets:", .status)
        api.get("/api/v1/ports", [Listener].self) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let listeners):
                for l in listeners.sorted(by: { $0.port < $1.port }) {
                    self.log("netstat", String(format: "%-6d %-22@ %@ (pid %d)", l.port, l.address as NSString, l.command, l.pid))
                }
            case .failure(let m): self.log("netstat", "Error: \(m)", .error)
            }
        }
    }

    @objc func runDoctor() {
        log("main", "Running doctor…", .status)
        api.get("/api/v1/doctor", [Check].self, timeout: 30) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let checks):
                for c in checks {
                    let icon = c.level == "ok" ? "✔" : (c.level == "warn" ? "!" : "✖")
                    self.log("doctor", "\(icon) \(c.title): \(c.detail)\(c.fix.map { " → \($0)" } ?? "")", c.level == "fail" ? .error : .normal)
                }
            case .failure(let m): self.log("doctor", "Error: \(m)", .error)
            }
        }
    }

    func openInConsole(_ path: String) {
        if FileManager.default.fileExists(atPath: path) {
            NSWorkspace.shared.open([URL(fileURLWithPath: path)], withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Console.app"), configuration: NSWorkspace.OpenConfiguration()) { _, _ in }
        } else {
            NSWorkspace.shared.open(URL(fileURLWithPath: api.home + "/logs"))
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
