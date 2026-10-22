// zampp Control Panel — a small native macOS window, like XAMPP's manager, that drives the
// local zampp API. Built with plain AppKit so it needs nothing but the system toolchain.
import AppKit
import Foundation

struct Service: Decodable {
    let id: String
    let name: String
    let description: String
    let installed: Bool
    let version: String?
    let running: Bool
    let pid: Int?
    let ports: [Int]
}
struct Urls: Decodable { let web: String; let adminer: String; let mail: String }
struct Panel: Decodable { let port: Int }
struct Settings: Decodable { let panel: Panel }
struct Status: Decodable {
    let version: String
    let home: String
    let services: [Service]
    let urls: Urls
    let settings: Settings
}
struct Envelope<T: Decodable>: Decodable { let data: T }
struct ApiErrorBody: Decodable { struct Inner: Decodable { let code: String; let message: String }; let error: Inner }
struct Check: Decodable { let title: String; let level: String; let detail: String; let fix: String? }

final class API {
    let home: String
    private(set) var token: String = ""
    private(set) var port: Int = 1980

    init() {
        let env = ProcessInfo.processInfo.environment
        if let h = env["ZAMPP_HOME"], !h.isEmpty { home = h } else { home = NSHomeDirectory() + "/.zampp" }
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

    func status(_ completion: @escaping (Result<Status, String>) -> Void) {
        request("GET", "/api/v1/status", timeout: 5) { result in
            completion(result.flatMap { data in
                (try? JSONDecoder().decode(Envelope<Status>.self, from: data)).map { .success($0.data) } ?? .failure("could not decode status")
            })
        }
    }
}

extension String: @retroactive Error {}

/// Finds the zampp CLI so the app can start the API server itself.
func findCli() -> String? {
    let env = ProcessInfo.processInfo.environment
    var candidates = [env["ZAMPP_CLI"] ?? "", "/opt/homebrew/bin/zampp", "/usr/local/bin/zampp", NSHomeDirectory() + "/.npm-global/bin/zampp"]
    candidates = candidates.filter { !$0.isEmpty && FileManager.default.isExecutableFile(atPath: $0) }
    return candidates.first
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
    path.move(to: NSPoint(x: 72, y: 176))
    path.line(to: NSPoint(x: 184, y: 176))
    path.line(to: NSPoint(x: 72, y: 80))
    path.line(to: NSPoint(x: 184, y: 80))
    NSColor(red: 0.06, green: 0.07, blue: 0.08, alpha: 1).setStroke()
    path.stroke()
    image.unlockFocus()
    return image
}

final class ServiceRow: NSView {
    let dot = NSTextField(labelWithString: "●")
    let name = NSTextField(labelWithString: "")
    let version = NSTextField(labelWithString: "")
    let ports = NSTextField(labelWithString: "")
    let pid = NSTextField(labelWithString: "")
    let start = NSButton(title: "Start", target: nil, action: nil)
    let stop = NSButton(title: "Stop", target: nil, action: nil)
    let restart = NSButton(title: "Restart", target: nil, action: nil)
    let logs = NSButton(title: "Logs", target: nil, action: nil)
    var serviceId = ""

    init(service: Service, target: AnyObject, action: Selector) {
        super.init(frame: .zero)
        serviceId = service.id
        for b in [start, stop, restart, logs] {
            b.bezelStyle = .rounded
            b.controlSize = .small
            b.font = NSFont.systemFont(ofSize: 11)
            b.target = target
            b.action = action
        }
        name.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        for f in [version, ports, pid] { f.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular); f.textColor = .secondaryLabelColor }
        name.widthAnchor.constraint(equalToConstant: 150).isActive = true
        version.widthAnchor.constraint(equalToConstant: 64).isActive = true
        ports.widthAnchor.constraint(equalToConstant: 96).isActive = true
        pid.widthAnchor.constraint(equalToConstant: 72).isActive = true
        dot.widthAnchor.constraint(equalToConstant: 16).isActive = true
        let stack = NSStackView(views: [dot, name, version, ports, pid, start, stop, restart, logs])
        stack.orientation = .horizontal
        stack.spacing = 8
        stack.alignment = .centerY
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
        ])
        update(service)
    }
    required init?(coder: NSCoder) { fatalError() }

    func update(_ s: Service) {
        name.stringValue = s.name
        version.stringValue = s.version ?? "—"
        ports.stringValue = s.ports.isEmpty ? "" : s.ports.map { ":\($0)" }.joined(separator: " ")
        pid.stringValue = s.pid.map { "pid \($0)" } ?? ""
        dot.textColor = s.running ? NSColor.systemGreen : (s.installed ? NSColor.systemRed : NSColor.systemOrange)
        start.isEnabled = !s.running
        start.title = s.installed ? "Start" : "Install"
        stop.isEnabled = s.running
        restart.isEnabled = s.running
        toolTip = s.description
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let api = API()
    var window: NSWindow!
    let rowsStack = NSStackView()
    var rows: [String: ServiceRow] = [:]
    let logView = NSTextView()
    let statusLabel = NSTextField(labelWithString: "Connecting to zampp…")
    var timer: Timer?
    var lastStatus: Status?
    var lastServeAttempt: Date = .distantPast
    var busy: Set<String> = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = makeIcon()
        buildMenu()
        buildWindow()
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About zampp", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit zampp Control Panel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }

    func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 540), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "zampp Control Panel"
        window.center()
        window.minSize = NSSize(width: 700, height: 420)

        let header = NSTextField(labelWithString: "Services")
        header.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        header.textColor = .secondaryLabelColor

        rowsStack.orientation = .vertical
        rowsStack.spacing = 2
        rowsStack.alignment = .leading
        let rowsBox = NSBox()
        rowsBox.boxType = .custom
        rowsBox.cornerRadius = 8
        rowsBox.borderColor = NSColor.separatorColor
        rowsBox.fillColor = NSColor.controlBackgroundColor
        rowsBox.contentViewMargins = .zero
        rowsBox.contentView = rowsStack
        rowsStack.translatesAutoresizingMaskIntoConstraints = false
        if let cv = rowsBox.contentView {
            NSLayoutConstraint.activate([
                rowsStack.leadingAnchor.constraint(equalTo: cv.leadingAnchor),
                rowsStack.trailingAnchor.constraint(equalTo: cv.trailingAnchor),
                rowsStack.topAnchor.constraint(equalTo: cv.topAnchor, constant: 4),
                rowsStack.bottomAnchor.constraint(equalTo: cv.bottomAnchor, constant: -4),
            ])
        }

        func button(_ title: String, _ sel: Selector, primary: Bool = false) -> NSButton {
            let b = NSButton(title: title, target: self, action: sel)
            b.bezelStyle = .rounded
            if primary { b.keyEquivalent = "\r" }
            return b
        }
        let actions = NSStackView(views: [
            button("Start All", #selector(startAll), primary: true),
            button("Stop All", #selector(stopAll)),
            NSView(),
            button("Localhost", #selector(openWeb)),
            button("Database", #selector(openDb)),
            button("Mail", #selector(openMail)),
            button("Web Panel", #selector(openPanel)),
            button("Doctor", #selector(runDoctor)),
            button("Folder", #selector(openHome)),
        ])
        actions.orientation = .horizontal
        actions.spacing = 8
        actions.distribution = .fill
        (actions.views[2]).setContentHuggingPriority(.defaultLow, for: .horizontal)

        logView.isEditable = false
        logView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        logView.textColor = .labelColor
        logView.backgroundColor = NSColor.textBackgroundColor
        logView.textContainerInset = NSSize(width: 6, height: 6)
        let scroll = NSScrollView()
        scroll.documentView = logView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        logView.autoresizingMask = [.width]
        logView.isVerticallyResizable = true
        logView.textContainer?.widthTracksTextView = true
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true

        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor

        let root = NSStackView(views: [header, rowsBox, actions, scroll, statusLabel])
        root.orientation = .vertical
        root.spacing = 10
        root.alignment = .leading
        root.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 12, right: 14)
        root.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            root.topAnchor.constraint(equalTo: content.topAnchor),
            root.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            rowsBox.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
            actions.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
            scroll.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
        ])
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        log("zampp Control Panel. Home: \(api.home)")
    }

    func log(_ message: String) {
        let stamp = DateFormatter()
        stamp.dateFormat = "HH:mm:ss"
        let line = "[\(stamp.string(from: Date()))] \(message)\n"
        DispatchQueue.main.async {
            self.logView.textStorage?.append(NSAttributedString(string: line, attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: NSColor.labelColor]))
            self.logView.scrollToEndOfDocument(nil)
        }
    }

    func refresh() {
        api.status { [weak self] result in
            guard let self = self else { return }
            DispatchQueue.main.async {
                switch result {
                case .success(let status):
                    self.lastStatus = status
                    self.render(status)
                    let running = status.services.filter { $0.running }.count
                    self.statusLabel.stringValue = "zampp \(status.version) · \(running)/\(status.services.count) services running · API 127.0.0.1:\(self.api.port)"
                case .failure(let message):
                    self.statusLabel.stringValue = "API not reachable (\(message))"
                    self.ensureApiRunning()
                }
            }
        }
    }

    /// If the API is down, start `zampp serve` ourselves (once every 10 seconds at most).
    func ensureApiRunning() {
        guard Date().timeIntervalSince(lastServeAttempt) > 10 else { return }
        lastServeAttempt = Date()
        api.reloadConfig()
        guard let cli = findCli() else {
            log("The zampp API is not running and the `zampp` command was not found. Run `zampp ui` in a terminal.")
            return
        }
        log("Starting the zampp API (\(cli) serve)…")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: cli)
        p.arguments = ["serve"]
        let logFile = api.home + "/logs/panel.out.log"
        FileManager.default.createFile(atPath: logFile, contents: nil)
        if let handle = FileHandle(forWritingAtPath: logFile) {
            handle.seekToEndOfFile()
            p.standardOutput = handle
            p.standardError = handle
        }
        do { try p.run() } catch { log("Could not start the API: \(error.localizedDescription)") }
    }

    func render(_ status: Status) {
        var seen = Set<String>()
        for (index, service) in status.services.enumerated() {
            seen.insert(service.id)
            if let row = rows[service.id] {
                row.update(service)
                if busy.contains(service.id) { [row.start, row.stop, row.restart].forEach { $0.isEnabled = false } }
            } else {
                let row = ServiceRow(service: service, target: self, action: #selector(rowAction(_:)))
                rows[service.id] = row
                rowsStack.insertArrangedSubview(row, at: min(index, rowsStack.arrangedSubviews.count))
                row.widthAnchor.constraint(equalTo: rowsStack.widthAnchor).isActive = true
            }
        }
        for (id, row) in rows where !seen.contains(id) {
            rowsStack.removeArrangedSubview(row)
            row.removeFromSuperview()
            rows.removeValue(forKey: id)
        }
    }

    @objc func rowAction(_ sender: NSButton) {
        guard let row = sender.superview?.superview as? ServiceRow ?? sender.superview as? ServiceRow else { return }
        let id = row.serviceId
        if sender == row.logs {
            open(path: api.home + "/logs")
            return
        }
        let action = sender == row.start ? "start" : sender == row.stop ? "stop" : "restart"
        serviceAction(id, action)
    }

    func serviceAction(_ id: String, _ action: String) {
        busy.insert(id)
        if let s = lastStatus { render(s) }
        log("\(action) \(id)…")
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        api.request("POST", "/api/v1/services/\(encoded)/\(action)") { [weak self] result in
            guard let self = self else { return }
            DispatchQueue.main.async {
                self.busy.remove(id)
                switch result {
                case .success: self.log("\(id): \(action) ok")
                case .failure(let message): self.log("\(id): \(message)")
                }
                self.refresh()
            }
        }
    }

    @objc func startAll() {
        log("Starting the stack (installs anything missing)…")
        api.request("POST", "/api/v1/stack/start", timeout: 600) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let data):
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let inner = json["data"] as? [String: Any],
                   let failed = inner["failed"] as? [[String: Any]], !failed.isEmpty {
                    for f in failed { self.log("\(f["id"] ?? ""): \(f["error"] ?? "")") }
                } else {
                    self.log("Stack started")
                }
            case .failure(let message): self.log("Start failed: \(message)")
            }
            DispatchQueue.main.async { self.refresh() }
        }
    }

    @objc func stopAll() {
        log("Stopping all services…")
        api.request("POST", "/api/v1/stack/stop") { [weak self] result in
            if case .failure(let m) = result { self?.log("Stop failed: \(m)") } else { self?.log("All services stopped") }
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    @objc func runDoctor() {
        api.request("GET", "/api/v1/doctor") { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let data):
                if let checks = try? JSONDecoder().decode(Envelope<[Check]>.self, from: data).data {
                    for c in checks {
                        let icon = c.level == "ok" ? "✔" : (c.level == "warn" ? "!" : "✖")
                        self.log("\(icon) \(c.title): \(c.detail)\(c.fix.map { " → \($0)" } ?? "")")
                    }
                }
            case .failure(let message): self.log("Doctor failed: \(message)")
            }
        }
    }

    func open(url: String) { if let u = URL(string: url) { NSWorkspace.shared.open(u) } }
    func open(path: String) { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
    @objc func openWeb() { open(url: lastStatus?.urls.web ?? "http://localhost:8080/") }
    @objc func openDb() { open(url: lastStatus?.urls.adminer ?? "http://localhost:8080/adminer/") }
    @objc func openMail() { open(url: lastStatus?.urls.mail ?? "http://127.0.0.1:8025/") }
    @objc func openPanel() { open(url: "\(api.base)/?token=\(api.token)") }
    @objc func openHome() { open(path: api.home) }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
